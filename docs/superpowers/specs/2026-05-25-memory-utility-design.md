# Memory Utility Design for AI Pharmacy Project

## Overview
This document describes the design for a memory utility script (`patch-claude-mem.js`) that will help manage project-specific memories for the AI Pharmacy project. The utility will focus on updating existing project memories as requested by the user.

## Purpose
Create a utility to update project memories in the `.claude/projects/e--CURRENT-PROJECT-ON-WORKING-AI-PHARMACY\memory\` directory. Project memories contain information about ongoing work, goals, initiatives, bugs, or incidents within the project.

## Requirements
Based on user responses:
- Primary operation: Update existing memories
- Memory type: Project memories

## Design

### File Structure
The utility will be located at:
`e:\CURRENT PROJECT ON WORKING\AI PHARMACY\patch-claude-mem.js`

### Key Features
1. **Memory Discovery**: Locate the project's memory directory
2. **Memory Listing**: Display existing project memories
3. **Memory Selection**: Allow user to select which memory to update
4. **Memory Editing**: Provide interface to update memory content
5. **Validation**: Ensure memory files follow the correct format

### Memory Format
Project memories follow this format:
```markdown
---
name: {{short-kebab-case-slug}}
description: {{one-line summary}}
metadata:
  type: {{project}}
---

{{memory content — structured as: fact/decision, then **Why:** and **How to apply:** lines.}}
```

### User Workflow
1. Run the script: `node patch-claude-mem.js`
2. Script displays list of existing project memories
3. User selects a memory to update (or chooses to create new)
4. Script opens selected memory in editor for modification
5. User edits and saves the memory
6. Script validates the memory format before saving
7. Confirmation of successful update

### Implementation Approach
- Use Node.js with built-in `fs` module for file operations
- Use `readline` for user interaction in terminal
- Provide helpful error messages and validation
- Follow Windows path conventions as per CLAUDE.md

## Components

### Main Functions
1. `getMemoryDirectory()` - Returns path to project memory directory
2. `listProjectMemories()` - Lists all *.md files in memory directory
3. `selectMemory()` - Prompts user to choose memory to update
4. `readMemory(filePath)` - Reads and returns memory content
5. `updateMemory(content)` - Allows user to edit memory content
6. `validateMemoryFormat(content)` - Validates memory follows required format
7. `saveMemory(filePath, content)` - Saves updated memory to file

## Error Handling
- If memory directory doesn't exist, create it
- If no memories exist, inform user and offer to create new
- Validate memory format before saving
- Handle file I/O errors gracefully
- Provide clear error messages to user

## Integration with Existing Systems
- Works alongside existing Claude Code memory system
- Does not modify global or user-level memories
- Only affects project-specific memories for AI Pharmacy
- Follows same formatting rules as existing memory files

## Testing Approach
1. Test with existing memory files (if any)
2. Test creating new memory directory
3. Test updating various memory formats
4. Test validation with malformed memory content
5. Test edge cases (empty files, special characters, etc.)

## Future Enhancements
- Support for other memory types (user, feedback, reference)
- Search/filter capabilities
- Batch operations
- Integration with Claude Code hooks