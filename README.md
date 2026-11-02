# Anki Flashcard Maker

A responsive Anki deck builder with PDF study and snipping tools. The project is organized as a frontend and API backend in one repository.

## Repository layout

- `frontend/` — React + Vite app
- `backend/` — FastAPI service that generates `.apkg` files

## Run locally

Start the backend in one terminal:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

The Vite app uses `http://127.0.0.1:8000` for the backend in development. Set `VITE_BACKEND_URL` when deploying the frontend to point it at the deployed API.

## Checks

```powershell
cd frontend
npm run lint
npm run build
```

## Vercel deployment

This repository uses two Vercel projects: `create-flashcards` builds from `frontend/`, and `create-flashcards-api` builds from `backend/`. The frontend's `VITE_BACKEND_URL` environment variable points to the API project. Vercel Function requests and responses are limited to 4.5 MB, so unusually large image-heavy decks may exceed the API's current hosting limit.
