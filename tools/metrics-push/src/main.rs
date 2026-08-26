//! Scrapes prometheus-node-exporter-lua on localhost and pushes the exposition text to
//! VictoriaMetrics, for hosts that have no inbound route for VMAgent to scrape.
//!
//! Runs as one long-lived process so the outbound TLS connection is established once and
//! reused, rather than paying a handshake every interval like a cron'd curl would. Steady
//! state allocates nothing: the scrape body is read into a single buffer that is cleared
//! and refilled each tick.

use std::io::Read;
use std::time::{Duration, Instant};

use ureq::Agent;
use ureq::tls::{RootCerts, TlsConfig};

/// Sized past a full node-exporter payload, so the buffer stops growing after the first tick.
const BUF_CAPACITY: usize = 128 * 1024;

struct Config {
    scrape_url: String,
    push_url: String,
    auth: String,
    interval: Duration,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_owned())
}

fn config() -> Result<Config, String> {
    let token = std::env::var("METRICS_PUSH_TOKEN")
        .map_err(|_| "METRICS_PUSH_TOKEN is not set".to_owned())?;
    if token.is_empty() {
        return Err("METRICS_PUSH_TOKEN is empty".to_owned());
    }

    let base = env_or("METRICS_PUSH_URL", "");
    if base.is_empty() {
        return Err("METRICS_PUSH_URL is not set".to_owned());
    }

    let secs: u64 = env_or("METRICS_PUSH_INTERVAL", "15")
        .parse()
        .map_err(|_| "METRICS_PUSH_INTERVAL is not a number of seconds".to_owned())?;
    if secs == 0 {
        return Err("METRICS_PUSH_INTERVAL must be at least 1".to_owned());
    }

    let instance = env_or("METRICS_PUSH_INSTANCE", "router");
    let job = env_or("METRICS_PUSH_JOB", "node");

    // The identifying labels ride on the URL rather than being injected into the payload, so
    // this stays a byte-for-byte passthrough of whatever the exporter produced.
    let push_url = format!("{base}?extra_label=instance={instance}&extra_label=job={job}");

    Ok(Config {
        scrape_url: env_or("METRICS_SCRAPE_URL", "http://127.0.0.1:9100/metrics"),
        push_url,
        auth: format!("Bearer {token}"),
        interval: Duration::from_secs(secs),
    })
}

/// One scrape-and-push. Failures are per-tick and never fatal: a router that just lost its
/// uplink should keep trying, and a gap in the series is the honest signal meanwhile.
fn tick(agent: &Agent, cfg: &Config, buf: &mut Vec<u8>) -> Result<usize, ureq::Error> {
    buf.clear();
    agent
        .get(&cfg.scrape_url)
        .call()?
        .body_mut()
        .as_reader()
        .read_to_end(buf)?;

    let mut res = agent
        .post(&cfg.push_url)
        .header("Authorization", &cfg.auth)
        .header("Content-Type", "text/plain")
        .send(&buf[..])?;

    // Drain the (empty) 204 body so ureq returns the connection to its pool rather than
    // closing it. Reusing the TLS session is the whole reason this runs as a daemon.
    std::io::copy(&mut res.body_mut().as_reader(), &mut std::io::sink())?;

    Ok(buf.len())
}

fn main() {
    let cfg = match config() {
        Ok(cfg) => cfg,
        Err(err) => {
            eprintln!("metrics-push: {err}");
            std::process::exit(2);
        }
    };

    let agent: Agent = Agent::config_builder()
        // Well under the default interval, so a hung request can't stack up behind the next tick.
        .timeout_global(Some(Duration::from_secs(10)))
        .tls_config(TlsConfig::builder().root_certs(RootCerts::WebPki).build())
        .build()
        .into();

    let mut buf = Vec::with_capacity(BUF_CAPACITY);

    loop {
        let started = Instant::now();

        if let Err(err) = tick(&agent, &cfg, &mut buf) {
            eprintln!("metrics-push: {err}");
        }

        // Sleep the remainder of the interval, not a flat interval, so the cost of the scrape
        // and push doesn't make the series drift slower than the configured period.
        std::thread::sleep(cfg.interval.saturating_sub(started.elapsed()));
    }
}
