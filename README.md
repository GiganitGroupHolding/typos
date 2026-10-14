<p align="center">
  <img src="docs/cover.jpg" alt="TYPOS" width="100%">
</p>

<p align="center">
  <b>Study notes with real math, one folder per subject.</b><br>
  A notes app for Windows modeled on Apple Notes. It works offline and keeps everything as Markdown files on your disk.
</p>

<p align="center">
  <a href="#quick-start"><b>Quick start</b></a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

<p align="center">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-0b0d10?style=flat-square&logo=react&logoColor=61dafb">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-0b0d10?style=flat-square&logo=typescript&logoColor=3178c6">
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-0b0d10?style=flat-square&logo=vite&logoColor=a78bfa">
  <img alt="Markdown" src="https://img.shields.io/badge/Markdown-files-0b0d10?style=flat-square&logo=markdown&logoColor=ffffff">
  <img alt="KaTeX" src="https://img.shields.io/badge/KaTeX-math-0b0d10?style=flat-square&logo=latex&logoColor=16b3ad">
  <img alt="PWA" src="https://img.shields.io/badge/PWA-offline-0b0d10?style=flat-square&logo=pwa&logoColor=ff8a3d">
  <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-0b0d10?style=flat-square">
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/note-dark.webp">
  <img alt="A linear algebra note with matrices and formulas in the text" src="docs/screenshots/note-light.webp">
</picture>

<p align="center"><sub>The interface is in Russian.</sub></p>

## Why I made it

I couldn't find a notes app on Windows that I liked for studying. Notion is slow and needs a VPN where I live, and Apple Notes only runs on Apple devices.

In TYPOS a subject is a folder. Open it and the lecture notes are right there, next to the formula cards I revise from and the calculators I made for that subject. Formulas look like they do in a textbook, and the files stay on my computer.

## Features

- Markdown editor with KaTeX math. Write `$…$` inline and `$$…$$` for a block. Matrices, determinants and systems of equations render as you type.
- Formulas copied from websites and documents paste as formulas you can edit.
- Tables, text color and highlight, a toolbar over selected text, and a visual formula editor for when you don't remember the LaTeX.
- Formula cards for the key formulas of each subject, with a review mode for exam prep.
- Small HTML tools such as calculators and trainers live inside a subject. They run in a sandboxed iframe with no access to your notes.
- `Ctrl K` searches every subject. It ignores case and treats е and ё as the same letter.
- Deleted items stay in the trash for 30 days, and every delete can be undone.
- If a note's file changes on disk while the note is open, TYPOS loads the new version. If you have unsaved edits, it asks which version to keep.
- The interface is frosted glass over an animated background, in a light or dark theme. Inside a subject the accent color matches the subject's icon.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/subject-dark.webp">
  <img alt="A subject page with notes, formula cards and tools" src="docs/screenshots/subject-light.webp">
</picture>

<details>
<summary>Home screen</summary>
<br>
<img alt="Home screen with subjects and recent notes" src="docs/screenshots/home-light.webp">
</details>

## Quick start

You need Node.js 22 or newer, and Chrome or Edge. Those two browsers can read and write a folder on your disk.

```bash
git clone https://github.com/robloxlover44/typos.git
cd typos
npm install
npm run dev
```

Open <http://localhost:5173> and pick a folder for your notes. You can also start without one. Notes are then kept in the browser, and one button moves them to a folder later.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the app locally |
| `npm run build` | Type-checks and builds for production |
| `npm test` | Runs the tests with Vitest |
| `npm run icons` | Regenerates the icons and the logo from one shared geometry |

## How it works

Your notes are a normal folder. There is no database, only Markdown, JSON and images. The files open in Obsidian or VS Code and sync with whatever you already use.

```
Study/
├── .studynotes/trash/          deleted items, kept for 30 days
└── Math/                       one folder per subject
    ├── _subject.json           color, icon and order
    ├── Конспекты/              notes
    │   ├── Linear algebra.md
    │   └── assets/             images, saved as webp
    ├── Закреп/                 formula cards
    │   └── Cramer's rule.md
    └── Инструменты/            HTML tools
        └── Inverse matrix.html
```

The three folder names inside a subject are fixed: `Конспекты` for notes, `Закреп` for formula cards and `Инструменты` for tools.

A note is Markdown with a short frontmatter block. Its first line is the title, and the file is named after it.

```markdown
---
id: xu66wudd
created: 2026-10-12T22:08:03.308Z
updated: 2026-10-13T20:14:32.046Z
---

# Linear algebra

A 2×2 determinant: $\det A = ad - bc$
```

| Layer | Tech |
| --- | --- |
| Interface | React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Motion |
| Editor | Tiptap 3, KaTeX, MathLive |
| Storage and search | File System Access API, IndexedDB, MiniSearch |
| Background | three.js with a WebGL shader |
| Build | Vite 8, vite-plugin-pwa, Vitest |

```
src/
├── app/        app shell, routes, theme and subject colors
├── editor/     editor, math, paste handling and Markdown
├── features/   formula cards, tools, search, subjects
├── storage/    disk folder and browser storage
└── vault/      file format and operations on the notes folder
```

## Roadmap

- [ ] Desktop build with Tauri
- [ ] Folder sync and a phone app
- [ ] Spaced repetition for formula cards
- [ ] PDF course materials next to the notes

<br>

<p align="center">
  <img src="public/brand/typos-icon.svg" alt="" width="48"><br>
  <sub>TYPOS is a personal project, released under the <a href="LICENSE">MIT License</a>.</sub>
</p>
