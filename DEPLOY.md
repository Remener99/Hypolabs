# Деплой «Леммы»

Приложение — один Node-процесс (Express + встроенный SQLite `node:sqlite`), который
отдаёт и API, и собранный фронтенд на одном порту. Хранилище — файл `data/lemma.db`.
При первом старте база создаётся и автоматически засеивается демо-данными.

Требуется **Node 22.5+** (из-за `node:sqlite`). В Docker это уже учтено.

---

## Вариант 1 — Render, бесплатный план (без карты)

`render.yaml` настроен на `plan: free` — платёжные данные не запрашиваются.

1. Откройте https://render.com/deploy?repo=https://github.com/Remener99/Hypolabs
   (или в дашборде: **New → Blueprint** → репозиторий `Hypolabs` → ветка `main`).
2. Render прочитает `render.yaml`, соберёт `Dockerfile` и выдаст постоянный адрес
   вида `https://lemma-xxxx.onrender.com`.
3. Каждый пуш в `main` передеплоивается автоматически (`autoDeploy: true`).

Если раньше появлялось окно **Payment Information Required** — оно было из-за
`plan: starter` и блока `disk:` (постоянный диск требует платного инстанса).
В текущем blueprint их нет, окно не появится. Нажмите **Retry**, если вкладка
осталась открытой со старой конфигурацией.

### Ограничения бесплатного плана — важно понимать

| Ограничение | Что это значит на практике |
|---|---|
| Нет постоянного диска | База живёт на временной ФС и **пересоздаётся с демо-данными** при редеплое, рестарте и пробуждении. Внесённые изменения не сохраняются. |
| Засыпает через ~15 мин без трафика | Первый запрос после простоя ждёт ~30–60 секунд, пока сервис просыпается. |
| 512 МБ RAM, 0.1 CPU | Для этого приложения достаточно. |
| 750 инстанс-часов/месяц | Хватает на один сервис, работающий круглосуточно (~744 ч). |

Для демонстрации продукта это нормально: приложение всегда открывается с
наполненным демо-кабинетом. Для реальных накопленных данных нужен вариант 2 или 3.

**Чтобы ссылка не засыпала:** заведите бесплатный пинг на `https://<ваш-адрес>/api/health`
каждые 10 минут (например, cron-job.org или UptimeRobot). Один сервис, работающий
24/7, укладывается в 750 бесплатных часов.

### Апгрейд до постоянных данных на Render (~$7/мес + диск)

В `render.yaml` два изменения:

```yaml
    plan: starter        # было: plan: free
    disk:                # раскомментировать блок
      name: lemma-data
      mountPath: /app/data
      sizeGB: 1
```

Понадобится карта, которую принимает Stripe (карты, выпущенные в РФ, обычно не проходят).

---

## Вариант 2 — свой VPS (постоянные данные, без Stripe)

Подходит, если нужны и постоянство, и независимость от зарубежных платежей
(Timeweb, Selectel, Yandex Cloud, VK Cloud и т.п.).

```bash
# на сервере с установленным Docker
git clone https://github.com/Remener99/Hypolabs.git && cd Hypolabs
docker build -t lemma .
docker run -d --name lemma --restart unless-stopped \
  -p 3000:3000 -v lemma-data:/app/data lemma
```

Откройте `http://IP_СЕРВЕРА:3000`. Том `lemma-data` хранит базу между рестартами.
Если `git clone` недоступен — загрузите архив проекта, распакуйте и соберите образ.

Домен и HTTPS через Caddy (`/etc/caddy/Caddyfile`):

```
lemma.example.com {
    reverse_proxy localhost:3000
}
```

Caddy сам выпустит и продлит сертификат. Аналогично можно настроить nginx.

---

## Вариант 3 — другие Docker-хостинги

- **Railway:** New Project → Deploy from GitHub repo → найдёт `Dockerfile`.
  Добавьте Volume с mount path `/app/data`.
- **Fly.io:** `fly launch`, затем `fly volumes create lemma_data --size 1`
  и монтирование в `/app/data` в `fly.toml`, после — `fly deploy`.

## Вариант 4 — без Docker, прямо на сервере

```bash
npm ci
npm run build
NODE_ENV=production PORT=3000 npm start
```

Держите процесс под systemd/pm2 и проксируйте доменом. Каталог `data/` должен
сохраняться между перезапусками.

---

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT` | `3000` | порт HTTP |
| `NODE_ENV` | — | `production` на хостинге |

Пересоздать демо-данные вручную: `npm run seed`.

## Проверка после деплоя

- `GET /api/health` → `{"ok":true,...}` — живость (используется хостингом и CI).
- Откройте корень, войдите: `demo@lemma.ru` / `lemma2026`.

## CI

Готовый workflow лежит в `deploy/ci.yml`: на каждый пуш и PR ставит зависимости,
собирает фронтенд, поднимает сервер и гоняет UI-тесты (`npm run test:ui`).

**Активация:** GitHub не даёт интеграции из песочницы создавать файлы в
`.github/workflows/` (нужно право `workflows`). Включите одним из способов:

- в веб-интерфейсе GitHub: **Add file → Create new file**, путь
  `.github/workflows/ci.yml`, вставьте содержимое `deploy/ci.yml`; или
- с локальной машины с токеном, у которого есть право `workflows`:
  ```bash
  mkdir -p .github/workflows
  cp deploy/ci.yml .github/workflows/ci.yml
  git add .github/workflows/ci.yml && git commit -m "Включить CI" && git push
  ```
