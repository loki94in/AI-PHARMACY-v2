# Migration Enhancement Design

## Overview
Enhance the migration functionality to support multiple archive formats (.zip, .tar, .gz, .7z) and various content formats inside archives (.sql, .csv, .json, .xml) for flexible data migration.

## Goals
1. Support multiple archive types beyond .zip
2. Process different data formats inside archives
3. Maintain backward compatibility with existing .zip + .sql migrations
4. Provide extensible architecture for future format support
5. Preserve existing error handling and status reporting

## Architecture

### Core Components
1. **Migration Controller** (`src/routes/migration.ts`) - Enhanced to accept new archive types
2. **Migration Worker** (`src/worker/migrationWorker.ts`) - Core processing logic enhanced
3. **Format Handlers** - New modules for archive extraction and content processing
4. **Parser Registry** - System to register and select appropriate parsers based on content

### Detailed Changes

#### 1. Archive Extraction Enhancement
- Replace direct `unzipper` usage with format-aware extractor
- Support formats: .zip, .tar, .gz, .7z
- Use appropriate libraries or system calls for each format
- Fallback mechanism for corrupted or misidentified files

#### 2. Content Processing Enhancement
- After extraction, scan for supported content files:
  - Database: .sql files
  - Application data: .csv, .json, .xml files
  - Configuration: .yaml, .yml, .ini, .properties
- Route content to appropriate processors based on file extension
- Each processor handles validation, transformation, and import

#### 3. Parser Registry System
- Create `src/worker/parsers/registry.ts` to manage parser registration
- Each parser implements a common interface:
  ```typescript
  interface DataParser {
    canParse(filePath: string): boolean;
    parse(filePath: string, db: sqlite3.Database): Promise<ParseResult>;
  }
  ```
- Existing parsers (returns, inventory, sales) will be registered
- New parsers for CSV, JSON, XML can be added easily

#### 4. Configuration
- Environment variable `MIGRATION_ALLOWED_EXTENSIONS` to specify allowed file types
- Default: ['.zip', '.tar', '.gz', '.7z'] for archives, ['.sql', '.csv', '.json', '.xml'] for content
- Configurable via `.env` file or process environment

### Data Flow
1. User uploads archive file via `/routes/migration/upload`
2. File stored in `MIGRATION SAMPEL` directory
3. Manual trigger via `/routes/migration/run` with filename
4. Migration worker:
   - Validates file extension against allowed archives
   - Extracts archive to temp directory using appropriate extractor
   - Scans extracted files for allowed content types
   - For each content file, selects appropriate parser from registry
   - Processes each file with its parser
   - Updates migration status throughout
   - Archives processed file on success
   - Cleans up temp files

### Error Handling
- Validate archive integrity before extraction
- Provide meaningful errors for unsupported formats
- Graceful degradation: if one file fails, continue with others and report partial success
- Preserve existing error handling patterns and status updates
- Cleanup temp directories on both success and failure

### Testing Approach
1. Unit tests for each format handler
2. Integration tests for archive extraction with sample files
3. Parser registry tests for correct parser selection
4. End-to-end test with sample migration archives
5. Maintain existing test compatibility (`npm test` should still pass)

## Implementation Plan
1. Create format handler modules (archive extractors)
2. Implement parser registry system
3. Enhance migration worker with new logic
4. Update migration routes for new file type validation
5. Add configuration via environment variables
6. Write comprehensive tests
7. Update documentation

## Backward Compatibility
- Existing .zip + .sql migrations work unchanged
- No changes to public API endpoints
- Same request/response formats
- Migration status reporting preserved

## Security Considerations
- Validate file extensions to prevent path traversal
- Limit extraction to safe directories
- Scan extracted files for allowed content types only
- Consider virus scanning for uploaded files in production