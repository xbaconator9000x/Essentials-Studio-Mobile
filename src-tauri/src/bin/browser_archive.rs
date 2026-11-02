//! Browser-first local ZIP utility. Uses the SAME native archive reader/writer
//! as the Android app; never reimplements Ruby Marshal or ZIP extraction.
//! Usage: browser_archive import SOURCE.zip NEW_WORKING_DIRECTORY
//!        browser_archive export PROJECT_DIRECTORY NEW_OUTPUT.zip
use essentials_studio_lib::commands::project_archive::{
    export_archive_to_new_file, import_archive_into_new_directory,
};
use std::{env, path::PathBuf};

fn run() -> Result<(), String> {
    let mut args = env::args_os().skip(1);
    let action = args.next().ok_or("Expected import or export action")?;
    let source = PathBuf::from(args.next().ok_or("Missing source path")?);
    let destination = PathBuf::from(args.next().ok_or("Missing destination path")?);
    if args.next().is_some() {
        return Err("Expected exactly an action, source path and destination path".into());
    }
    match action.to_str() {
        Some("import") => {
            let root = import_archive_into_new_directory(&source, &destination)?;
            println!("{}", root.display());
        }
        Some("export") => {
            let size = export_archive_to_new_file(&source, &destination)?;
            println!("{size}");
        }
        _ => return Err("Expected import or export action".into()),
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Browser archive operation failed: {error}");
        std::process::exit(1);
    }
}
