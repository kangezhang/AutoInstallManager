use serde::{Serialize, Serializer};
use std::fmt;

/// Unified error type returned to the frontend.
///
/// Tauri serializes the error via Serialize, so the renderer always sees a
/// stable shape: `{ kind, message }`.
#[derive(Debug)]
pub enum AppError {
    Io(std::io::Error),
    Network(String),
    GitHub(String),
    Catalog(String),
    Install(String),
    Auth(String),
    NotFound(String),
    Validation(String),
    Other(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Io(e) => write!(f, "{}", e),
            AppError::Network(m)
            | AppError::GitHub(m)
            | AppError::Catalog(m)
            | AppError::Install(m)
            | AppError::Auth(m)
            | AppError::NotFound(m)
            | AppError::Validation(m)
            | AppError::Other(m) => f.write_str(m),
        }
    }
}

impl std::error::Error for AppError {}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let kind = match self {
            AppError::Io(_) => "io",
            AppError::Network(_) => "network",
            AppError::GitHub(_) => "github",
            AppError::Catalog(_) => "catalog",
            AppError::Install(_) => "install",
            AppError::Auth(_) => "auth",
            AppError::NotFound(_) => "not_found",
            AppError::Validation(_) => "validation",
            AppError::Other(_) => "other",
        };
        let mut map = std::collections::BTreeMap::new();
        map.insert("kind", kind.to_string());
        map.insert("message", self.to_string());
        map.serialize(serializer)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e)
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other(format!("json: {}", e))
    }
}

impl From<serde_yaml::Error> for AppError {
    fn from(e: serde_yaml::Error) -> Self {
        AppError::Catalog(format!("yaml: {}", e))
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Other(e.to_string())
    }
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        AppError::Other(format!("git: {}", e))
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Other(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Other(s.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
