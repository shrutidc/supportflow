# SupportFlow

SupportFlow is an enterprise-style **customer support ticket console** that models how a mid-size B2B SaaS team triages, assigns, escalates, and resolves customer issues. The frontend is built with vanilla **HTML, CSS, and JavaScript**; a **Node.js + Express + MongoDB** backend persists and serves the tickets.

## Objectives & goals

- Model a realistic **support ticket lifecycle** (not just a to-do list) — ownership, escalation, priority, and SLA behavior.
- Practice a **full-stack CRUD application** end to end: static UI → REST API → database, with seed data for a believable demo.
- Keep the frontend dependency-free (vanilla JS) to demonstrate core DOM/state work without a framework.

## Overview

Support agents work two views: a **Ticket Queue (Dashboard)** for triage and a **Ticket Detail** page for the conversation and metadata. Tickets move through a defined status lifecycle, can be claimed by a single agent, and escalate into an engineering queue with a tighter SLA.

## Features

- **Ticket queue dashboard** seeded with realistic B2B SaaS issues
- **Status lifecycle:** `New → In Progress → Escalated → Closed`
- **Ownership model:** tickets may start unassigned; once claimed they have single-agent ownership
- **Escalation logic:** reassign to the **Engineering Queue**, bump **priority to High**, apply a **tighter SLA** indicator
- **Status filter buttons**, **clickable ticket rows**, a **collapsible sidebar**, and **Light/Dark mode**

## Methodology / how it's built

- **Frontend** renders ticket rows and detail views from data returned by the API (`main.js`, `ticket.js`), with all styling in `styles.css`.
- **Backend** (`server/`) is an Express app exposing REST endpoints backed by a Mongoose `Ticket` model (`server/models/Ticket.js`); `seed.js` wipes and repopulates the collection with 20 demo tickets across Billing, Integration, Bug, and Account Access.
- The Express server also serves the static frontend, so the whole app runs from one origin.

## Sample data

Built around a fictional mid-size B2B SaaS AI workflow-automation platform. **20 tickets** across four categories — **Billing, Integration, Bug, Account Access** — loaded via `npm run seed`.

## Project structure

```txt
SupportFlow/
├─ index.html          # entry point
├─ dashboard.html      # ticket queue + filters
├─ ticket.html         # ticket detail (conversation + metadata)
├─ reports.html        # placeholder (enterprise nav realism)
├─ settings.html       # placeholder (enterprise nav realism)
├─ styles.css
├─ data.js             # original static seed objects
├─ main.js             # dashboard rendering + filters
├─ ticket.js           # ticket detail behavior
└─ server/
   ├─ models/Ticket.js # Mongoose schema
   ├─ server.js        # Express API + static hosting
   ├─ seed.js          # DB seeding entry point
   └─ seedHandler.js   # maps data.js → MongoDB documents
```

## Setup & running locally

**Prerequisites:** Node.js 18+, and a MongoDB connection string (local `mongod` or a MongoDB Atlas cluster).

```bash
cd server
cp .env.example .env      # then edit .env with YOUR MongoDB URI — never commit it
npm install
npm run seed              # wipes + loads 20 sample tickets
npm start                 # or: npm run dev  (nodemon)
```

Open <http://localhost:3000/index.html>.

> ⚠️ **Security:** never commit your real `.env`. It is gitignored here. If a connection string is ever exposed, **rotate the database password immediately** — a leaked URI must be treated as compromised.

## Visualizations

> _Add a dashboard screenshot to showcase the UI, e.g._ `![Dashboard](docs/dashboard.png)`.

## Potential next steps

This repo is **v1**. The planned **v2** rebuilds it into an AI-native support platform:

- AI ticket **summarization and triage**, and Claude-generated response suggestions
- **Semantic search** across ticket history via vector embeddings
- Auto-generated **knowledge base** from resolved tickets, plus SLA monitoring and analytics
- Real **auth / multi-tenant workspaces** and async job processing

## Individual contributions

Sole author. I built the vanilla-JS frontend (dashboard, ticket detail, filters, theming), the Express + MongoDB backend and `Ticket` schema, and the seed pipeline that maps the original static data into the database.

## Tech stack

`HTML5` · `CSS3 (Flexbox/Grid)` · `JavaScript` · `Node.js` · `Express` · `MongoDB / Mongoose`
