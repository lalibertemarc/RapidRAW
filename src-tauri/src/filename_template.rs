use std::cell::OnceCell;
use std::ffi::OsStr;
use std::path::Path;

use chrono::{DateTime, Local, Utc};
use regex::regex;
use serde::{Deserialize, Serialize};

use crate::exif_processing;
use crate::file_management::parse_virtual_path;
use crate::image_processing::{ImageFlag, ImageMetadata};
use crate::tagging::COLOR_TAG_PREFIX;

#[derive(Serialize, Deserialize, Debug, Clone, Copy, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FilenameCase {
    #[default]
    AsIs,
    Lower,
    Upper,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilenameSettings {
    #[serde(default)]
    pub filename_template: Option<String>,
    #[serde(default)]
    pub sequence_start: Option<usize>,
    #[serde(default)]
    pub custom_text: Option<String>,
    #[serde(default)]
    pub filename_case: FilenameCase,
    #[serde(default)]
    pub preset_name: Option<String>,
}

impl FilenameSettings {
    pub fn export_stem(
        &self,
        source_path: &Path,
        sidecar_path: &Path,
        index: usize,
        total: usize,
        now: DateTime<Local>,
    ) -> String {
        let capture_date = exif_processing::get_creation_date_from_path(source_path);
        let mut context =
            FilenameContext::new(source_path, Some(sidecar_path), index, total, &capture_date);
        context.sequence_start = self.sequence_start.unwrap_or(1);
        context.now = now;
        context.custom_text = self.custom_text.as_deref().unwrap_or_default();
        context.preset_name = self.preset_name.as_deref().unwrap_or_default();
        context.case = self.filename_case;
        let template = self
            .filename_template
            .as_deref()
            .unwrap_or("{original_filename}_edited");
        generate_filename_from_template(template, &context)
    }
}

#[tauri::command]
pub async fn preview_export_filename(
    path: String,
    index: usize,
    total: usize,
    naming: FilenameSettings,
) -> String {
    let (source_path, sidecar_path) = parse_virtual_path(&path);
    naming.export_stem(&source_path, &sidecar_path, index, total, Local::now())
}

pub struct FilenameContext<'a> {
    pub original_path: &'a Path,
    pub sidecar_path: Option<&'a Path>,
    pub index: usize,
    pub total: usize,
    pub sequence_start: usize,
    pub capture_date: &'a DateTime<Utc>,
    pub now: DateTime<Local>,
    pub custom_text: &'a str,
    pub preset_name: &'a str,
    pub case: FilenameCase,
}

impl<'a> FilenameContext<'a> {
    pub fn new(
        original_path: &'a Path,
        sidecar_path: Option<&'a Path>,
        index: usize,
        total: usize,
        capture_date: &'a DateTime<Utc>,
    ) -> Self {
        Self {
            original_path,
            sidecar_path,
            index,
            total,
            sequence_start: 1,
            capture_date,
            now: Local::now(),
            custom_text: "",
            preset_name: "",
            case: FilenameCase::AsIs,
        }
    }
}

struct Resolver<'a> {
    ctx: &'a FilenameContext<'a>,
    capture: DateTime<Local>,
    metadata: OnceCell<ImageMetadata>,
}

impl<'a> Resolver<'a> {
    fn new(ctx: &'a FilenameContext<'a>) -> Self {
        Self {
            ctx,
            capture: ctx.capture_date.with_timezone(&Local),
            metadata: OnceCell::new(),
        }
    }

    fn metadata(&self) -> &ImageMetadata {
        self.metadata.get_or_init(|| {
            self.ctx
                .sidecar_path
                .map(|sidecar| {
                    let mut meta = exif_processing::load_sidecar(sidecar);
                    exif_processing::fill_missing_exif(&mut meta, self.ctx.original_path);
                    meta
                })
                .unwrap_or_default()
        })
    }

    fn exif_value(&self, keys: &[&str]) -> String {
        let exif = self.metadata().exif.as_ref();
        keys.iter()
            .filter_map(|key| exif.and_then(|exif| exif.get(*key)))
            .map(|value| value.trim())
            .find(|value| !value.is_empty())
            .unwrap_or_default()
            .to_string()
    }

    fn model(&self) -> String {
        let model = self.exif_value(&["Model"]);
        let make = self.exif_value(&["Make"]);
        let Some(brand) = make.split_whitespace().next() else {
            return model;
        };
        match model.get(..brand.len()) {
            Some(prefix) if prefix.eq_ignore_ascii_case(brand) => {
                let rest = model[brand.len()..].trim();
                if rest.is_empty() {
                    model
                } else {
                    rest.to_string()
                }
            }
            _ => model,
        }
    }

    fn sequence(&self, width: Option<usize>) -> String {
        let sequence = self.ctx.sequence_start + self.ctx.index;
        let width = width.unwrap_or_else(|| {
            (self.ctx.sequence_start + self.ctx.total.max(1) - 1)
                .to_string()
                .len()
        });
        format!("{:0width$}", sequence, width = width)
    }

    fn resolve(&self, token: &str, arg: Option<usize>) -> Option<String> {
        let capture = &self.capture;
        let now = &self.ctx.now;
        let value = match (token, arg) {
            ("sequence", width) => self.sequence(width),
            (_, Some(_)) => return None,
            ("original_filename", _) => file_stem(self.ctx.original_path),
            ("original_filename_number", _) => {
                let stem = file_stem(self.ctx.original_path);
                let prefix_len = stem.trim_end_matches(|c: char| c.is_ascii_digit()).len();
                stem[prefix_len..].to_string()
            }
            ("original_ext", _) => lossy(self.ctx.original_path.extension()),
            ("folder", _) => lossy(self.ctx.original_path.parent().and_then(Path::file_name)),
            ("total", _) => self.ctx.total.to_string(),
            ("YYYY", _) => capture.format("%Y").to_string(),
            ("YY", _) => capture.format("%y").to_string(),
            ("MM", _) => capture.format("%m").to_string(),
            ("Month", _) => capture.format("%B").to_string(),
            ("Mon", _) => capture.format("%b").to_string(),
            ("DD", _) => capture.format("%d").to_string(),
            ("hh", _) => capture.format("%H").to_string(),
            ("mm", _) => capture.format("%M").to_string(),
            ("ss", _) => capture.format("%S").to_string(),
            ("date", _) => capture.format("%Y-%m-%d").to_string(),
            ("time", _) => capture.format("%H%M%S").to_string(),
            ("subsec", _) => self.exif_value(&["SubSecTimeOriginal", "SubSecTime"]),
            ("export_date", _) => now.format("%Y-%m-%d").to_string(),
            ("export_time", _) => now.format("%H%M%S").to_string(),
            ("make", _) => self.exif_value(&["Make"]),
            ("model", _) => self.model(),
            ("lens", _) => self.exif_value(&["LensModel"]),
            ("iso", _) => {
                self.exif_value(&["PhotographicSensitivity", "ISOSpeed", "ISOSpeedRatings"])
            }
            ("focal", _) => affixed(
                "",
                self.exif_value(&["FocalLength"]).trim_end_matches("mm"),
                "mm",
            ),
            ("aperture", _) => affixed(
                "f",
                self.exif_value(&["FNumber"]).trim_start_matches("f/"),
                "",
            ),
            ("shutter", _) => self.exif_value(&["ExposureTime"]).replace(' ', ""),
            ("serial", _) => self.exif_value(&["SerialNumber", "BodySerialNumber"]),
            ("title", _) => self.exif_value(&["ImageDescription"]),
            ("author", _) => self.exif_value(&["Artist"]),
            ("copyright", _) => self.exif_value(&["Copyright"]),
            ("comments", _) => {
                let comments = self.exif_value(&["UserComment"]);
                if comments.starts_with("0x") {
                    String::new()
                } else {
                    comments
                }
            }
            ("rating", _) => self.metadata().rating.to_string(),
            ("label", _) => self
                .metadata()
                .tags
                .iter()
                .flatten()
                .find_map(|tag| tag.strip_prefix(COLOR_TAG_PREFIX))
                .unwrap_or_default()
                .to_string(),
            ("flag", _) => match self.metadata().flag {
                Some(ImageFlag::Pick) => "pick".to_string(),
                Some(ImageFlag::Reject) => "reject".to_string(),
                None => String::new(),
            },
            ("text", _) => self.ctx.custom_text.to_string(),
            ("preset", _) => self.ctx.preset_name.to_string(),
            _ => return None,
        };
        Some(sanitize_component(&value))
    }
}

fn lossy(value: Option<&OsStr>) -> String {
    value
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn file_stem(path: &Path) -> String {
    let stem = lossy(path.file_stem());
    if stem.is_empty() {
        "image".to_string()
    } else {
        stem
    }
}

fn affixed(prefix: &str, value: &str, suffix: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        String::new()
    } else {
        format!("{}{}{}", prefix, value, suffix)
    }
}

fn sanitize_component(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

pub fn generate_filename_from_template(template: &str, ctx: &FilenameContext) -> String {
    let resolver = Resolver::new(ctx);

    let resolved =
        regex!(r"\{([A-Za-z_]+)(?::(\d+))?\}").replace_all(template, |caps: &regex::Captures| {
            let arg = caps.get(2).and_then(|m| m.as_str().parse().ok());
            resolver
                .resolve(&caps[1], arg)
                .unwrap_or_else(|| caps[0].to_string())
        });

    let cased = match ctx.case {
        FilenameCase::AsIs => resolved.into_owned(),
        FilenameCase::Lower => resolved.to_lowercase(),
        FilenameCase::Upper => resolved.to_uppercase(),
    };

    let trimmed = cased.trim().trim_end_matches(['.', ' ']);
    if trimmed.is_empty() {
        file_stem(ctx.original_path)
    } else {
        trimmed.to_string()
    }
}
