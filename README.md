# StudyHub

A chat-centric study companion. Upload PDFs, Word or PowerPoint files, chat with an AI tutor that searches inside them, and generate quizzes from your material.

**Stack:** TanStack Start (React 19, SSR), Vite, Tailwind CSS 4, Supabase (auth, Postgres + pgvector, storage), OpenAI.

## Getting started

Requires Node.js 20+.

```sh
npm install
cp .env.example .env   # then fill in the values
npm run dev            # http://localhost:8080
```

Other scripts: `npm run build`, `npm run preview`, `npm run lint`, `npm run format`.

## Supabase setup

1. Create a Supabase project and copy the URL, publishable key and service role key into `.env`.
2. Apply the SQL files in [supabase/migrations](supabase/migrations) in order (SQL Editor, or `supabase link` then `supabase db push`).
3. Create a **private** Storage bucket named `materials`. The migrations add the row-level security policies for it, but not the bucket.

## Environment variables

See [.env.example](.env.example). The service role key, OpenAI key and demo credentials are server-only: never prefix them with `VITE_` and never commit `.env`.

## Recruiter demo login

The **Recruiter Demo Login** button signs everyone into one shared account.

1. In Supabase, go to Authentication → Users → Add user. Create a dedicated, confirmed user (not your personal account).
2. Set `DEMO_LOGIN_EMAIL` and `DEMO_LOGIN_PASSWORD` to that user's credentials.
3. Restart the app after changing environment variables.

All visitors share this account's data and use your OpenAI quota, so only put non-sensitive sample content in it and set a spending limit in your OpenAI account.

## Deploying to Vercel

1. Push the repository to GitHub and import it in Vercel. The framework preset can stay on "Other"; the build uses Nitro's Vercel preset automatically.
2. Add every variable from [.env.example](.env.example) under Project Settings → Environment Variables.
3. Deploy. The build command is `npm run build`.

In Supabase, add your Vercel URL under Authentication → URL Configuration so email links redirect correctly.
