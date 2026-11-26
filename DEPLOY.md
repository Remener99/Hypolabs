# Деплой «Леммы»

Приложение — один Node-процесс (Express + встроенный SQLite `node:sqlite`), который
отдаёт и API, и собранный фронтенд на одном порту. Постоянное хранилище — файл
`data/lemma.db`, поэтому хостингу нужен **постоянный диск**, примонтированный в `/app/data`.

Требуется **Node 22.5+** (из-за `node:sqlite`). В Docker это уже учтено.

## Вариант 1 — Render (проще всего, стабильный адрес)

1. Откройте https://render.com/deploy?repo=https://github.com/Remener99/Hypolabs
   (или в дашборде Render: **New → Blueprint** и выберите репозиторий).
2. Render прочитает `render.yaml` и создаст веб-сервис из `Dockerfile`.
3. Подтвердите создание. Через пару минут получите адрес вида
   `https://lemma-xxxx.onrender.com` — он постоянный.
4. Диск `lemma-data` (1 ГБ) хранит базу между деплоями. Каждый пуш в `main`
   автоматически передеплоивается (`autoDeploy: true`).

> Диск доступен на платном плане `starter`. На бесплатном плане диска нет — база
> будет пересоздаваться при рестарте (демо-данные засеваются автоматически).

## Вариант 2 — любой Docker-хостинг (Railway, Fly.io, VPS)

```bash
docker build -t lemma .
docker run -d --name lemma -p 3000:3000 -v lemma-data:/app/data lemma
```

- **Railway:** New Project → Deploy from GitHub repo → он сам найдёт `Dockerfile`.
  Добавьте Volume с mount path `/app/data`.
- **Fly.io:** `fly launch` (определит Dockerfile), затем `fly volumes create lemma_data --size 1`
  и примонтируйте в `/app/data` в `fly.toml`. `fly deploy`.
- **VPS:** тот же `docker run` за reverse-proxy (nginx/Caddy) с TLS.

## Вариант 3 — без Docker, прямо на сервере

```bash
npm ci
npm run build
NODE_ENV=production PORT=3000 npm start
```

Поставьте процесс под systemd/pm2, чтобы переживал рестарты, и проксируйте доменом.
Каталог `data/` должен сохраняться между перезапусками.

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | порт HTTP |
| `NODE_ENV` | — | `production` на хостинге |

База создаётся и засеивается автоматически при первом старте. Пересоздать демо-данные:
`npm run seed`.

## Проверка после деплоя

- `GET /api/health` → `{"ok":true,...}` — живость (используется хостингом и CI).
- Откройте корень, войдите: `demo@lemma.ru` / `lemma2026`.

## CI

Готовый workflow лежит в `deploy/ci.yml`: на каждый пуш и PR ставит зависимости,
собирает фронтенд, поднимает сервер и гоняет UI-тесты (`npm run test:ui`).
Зелёный CI = приложение собирается и ключевые экраны живые.

**Активация:** GitHub не даёт приложению-интеграции из песочницы создавать файлы
в `.github/workflows/` (нужно право `workflows`). Поэтому включите CI одним из способов:

- в веб-интерфейсе GitHub: **Add file → Create new file**, путь
  `.github/workflows/ci.yml`, вставьте содержимое `deploy/ci.yml`; или
- с локальной машины, где у токена есть право `workflows`:
  ```bash
  mkdir -p .github/workflows
  cp deploy/ci.yml .github/workflows/ci.yml
  git add .github/workflows/ci.yml && git commit -m "Включить CI" && git push
  ```

После этого Actions заработает автоматически.
