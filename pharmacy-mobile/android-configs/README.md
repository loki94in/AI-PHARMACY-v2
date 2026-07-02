# Android Configurations & Build Data

This directory contains Android-specific build instructions, settings configurations, and signing resources.

## Build Properties

- **minSdkVersion**: 28 (Supports Android 9.0+)
- **targetSdkVersion**: 34 (Android 14)
- **permissions**:
  - `CAMERA` (AI prescription scans)
  - `RECORD_AUDIO`
  - `READ_EXTERNAL_STORAGE`
  - `WRITE_EXTERNAL_STORAGE`

## Configuration Files

- The actual building is driven by `app.json` in the project root.
- A backup copy of the target `app.json` is stored here as `app.json.backup` for reference.
