# Delete Backup Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete all files present in the backup directory of the AI Pharmacy project

**Architecture:** Use PowerShell to list and delete files in the backup directory with safety preview. First show what will be deleted, then execute deletion upon user confirmation.

**Tech Stack:** PowerShell, Windows file system

---
### Task 1: Preview files to be deleted

**Files:**
- Preview: `E:\CURRENT PROJECT ON WORKING\AI PHARMACY\backup\*.db`

- [x] **Step 1: Write command to list backup files**

```powershell
Get-ChildItem -Path ".\backup" -File | Select-Object Name, Length, LastWriteTime
```

- [x] **Step 2: Run command to preview files**

Run: `Get-ChildItem -Path ".\backup" -File | Select-Object Name, Length, LastWriteTime`
Expected: List of approximately 50+ .db files with their sizes and timestamps

- [x] **Step 3: Count files to be deleted**

```powershell
(Get-ChildItem -Path ".\backup" -File).Count
```

- [x] **Step 4: Run count command**

Run: `(Get-ChildItem -Path ".\backup" -File).Count`
Expected: Number showing total files to be deleted (should be ~50+)

- [x] **Step 5: Commit preview script**

```bash
git add docs/superpowers/plans/2026-05-26-delete-backup-files.md
git commit -m "feat: add preview step for backup file deletion plan"
```

### Task 2: Delete backup files

**Files:**
- Modify: PowerShell execution environment

- [x] **Step 1: Write delete command**

```powershell
Get-ChildItem -Path ".\backup" -File | Remove-Item -Force
```

- [x] **Step 2: Run delete command**

Run: `Get-ChildItem -Path ".\backup" -File | Remove-Item -Force`
Expected: No output (successful deletion), return to prompt

- [x] **Step 3: Verify deletion**

```powershell
Get-ChildItem -Path ".\backup" | Measure-Object
```

- [x] **Step 4: Run verification command**

Run: `Get-ChildItem -Path ".\backup" | Measure-Object`
Expected: Count of 0 (empty directory)

- [x] **Step 5: Commit deletion verification**

```bash
git add docs/superpowers/plans/2026-05-26-delete-backup-files.md
git commit -m "feat: add deletion and verification steps for backup file cleanup"
```