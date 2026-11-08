# Взаимодействие с Python backend

Документ разделён на две части:
- **Согласовано** — правила, которые подтвердил backend-разработчик (28.10.2026). Frontend уже им следует.
- **Предложения** — формы данных, которые нужны интерфейсу. Они **не согласованы**: пути не придуманы, HTTP-реализации выбрасывают `contract_pending`, экраны работают на демо-данных.

---

## Часть 1. Согласовано

### Транспорт — `lib/api/client.ts`

| Правило | Как реализовано |
|---------|-----------------|
| JSON, поля в `snake_case` | `lib/api/case.ts`: ответ → `camelCase`, тело и параметры запроса → `snake_case`. Только в API-клиенте, компоненты работают с `camelCase` |
| Базовый URL | `API_BASE_URL` — только для сервера Next.js, в браузер не попадает (проверяется в `config/env.ts`) |
| Режим данных | `NEXT_PUBLIC_DATA_SOURCE=mock\|api`; репозитории модулей выбирают реализацию один раз |
| Авторизация JWT Bearer | Заголовок `Authorization: Bearer <access>`; без cookie-сессий и без `credentials: "include"` |
| Компания | Заголовок `X-Tenant: <slug>` для бизнес-запросов; slug из `GET /api/v1/me/` → `memberships[].tenant`. Tenant в путь не добавляется |
| Обновление токена | При 401 — один запрос `POST /api/v1/auth/token/refresh/` с `{ refresh }`, новый refresh из ответа сохраняется, старый больше не используется (backend: ротация + чёрный список, окна повторного использования нет). Параллельные запросы ждут одно общее обновление. Backend отклонил refresh (400/401) — токены удаляются, ошибка `unauthorized`; временный сбой (нет связи, 429, 5xx) — токены **не** удаляются, пользователь не выходит из системы |
| Проверка ответов | Каждый ответ проверяется Zod-схемой модуля; несовпадение → `invalid_response` |

### Авторизация — `lib/api/auth-api.ts`

| Endpoint | Назначение |
|----------|-----------|
| `POST /api/v1/auth/token/` | Логин → `{ access, refresh }` |
| `POST /api/v1/auth/token/refresh/` | `{ refresh }` → новая пара (refresh ротируется) |
| `GET /api/v1/me/` | `{ id, username, display_name?, is_platform_admin?, must_change_password?, memberships: [{ tenant, role, company?, department?, permissions? }] }` (поля с `?` — с backend P0-1) |
| `POST /api/v1/auth/logout/` | Завершить текущую сессию (один refresh) |
| `POST /api/v1/auth/logout-all/` | Завершить все сессии |
| `POST /api/v1/auth/password/change/` | `{ current_password, new_password }` → 204, снимает `must_change_password` (backend P0-1) |

Подключено: страницы `/login`, `/select-company`, выход в меню профиля, обновление токена в `proxy.ts`. Токены хранит сервер Next.js в httpOnly-cookie (см. `DECISIONS.md`). В режиме `mock` вход не нужен и не имитируется.

Проверено 31.10.2026 на реальном backend (ветка `feature/p0-4-cabinet`, локальный docker compose): неверный пароль с `request_id`, вход директора, РОП и менеджера (имя, роль и компания из `/me/`), возврат на `next`, MFA (`mfa_required` → поле кода → `invalid_otp` → вход), блокировка `account_locked`, ротация refresh в `proxy.ts` и выход на вход при отклонённом refresh, выход с отзывом токена (backend 205). Токены не видны из JS и не попадают в логи.

Один пользователь — одна активная компания: backend запрещает второе активное членство (`membership_one_active_per_user`). Поэтому `/select-company` с этим backend не показывается; страница остаётся на случай платформенного администратора и будущих изменений.

### Вход: фактическое поведение backend (сверено с кодом ветки `feature/p0-4-cabinet`, 31.10.2026)

- Тело входа: `{ username, password, otp? }`. Ответ — `{ access, refresh }`. Access живёт 10 мин, refresh — 24 ч (настройки backend по умолчанию), в токенах есть `exp`.
- Ошибки входа (`lib/auth/actions.ts` → `apiLoginError`):
  - 401 `authentication_failed` — неверный логин или пароль **и** отключённый аккаунт (backend их не различает) → «Неверный логин или пароль»;
  - 401 `mfa_required` — у аккаунта включена MFA → форма показывает поле кода, запрос повторяется с `otp`;
  - 401 `invalid_otp` — неверный код;
  - 429 `account_locked` — временная блокировка после неудачных попыток (без `Retry-After`);
  - 429 `throttled` — ограничение частоты (с заголовком `Retry-After`).
- `/me/` с P0-1: `display_name` (имя и фамилия или логин), `is_platform_admin`, `must_change_password`, у членства — `company { id, name, country, currency, timezone }`, `department { id, name } | null`, `permissions[]`. Поля необязательны в схеме frontend, чтобы работать и с более ранней версией backend.
- **Ограничение backend:** `must_change_password` проверяет только frontend — backend не запрещает другие запросы с временным паролем.
- **Риск ограничения частоты:** все запросы идут с сервера Next.js, то есть с одного IP. Анонимные `auth/token/` и `auth/token/refresh/` попадают в общий лимит `auth` (10/мин) на всех пользователей. Нужно решение backend (`TRUSTED_PROXY_COUNT` + `X-Forwarded-For` или лимит refresh по токену). Не проверено под нагрузкой.

### Ошибки — `lib/api/errors.ts`

Тело: `{ "error": { "code", "message", "details"?, "request_id" } }`.

- `code = validation_error` → `ApiError.kind = "validation"`, `details` (формат DRF `{ field: ["…"] }`) → `ApiError.fieldErrors` с именами полей в `camelCase`.
- Остальные коды: вид ошибки по HTTP-статусу (401, 403, 404, 400/422, 409 → `conflict`, 429 → `rate_limited` с `retryAfterSeconds` из `Retry-After`, прочие → server). 404 без `X-Tenant` — тоже `not_found`.
- `request_id` сохраняется в `ApiError.requestId` для логов и обращения в поддержку. Пользователю показываются только понятные тексты из `API_ERROR_MESSAGES`, без технических подробностей.

### Пагинация — `lib/api/pagination.ts`

`limit` 1–200 (по умолчанию 50), `offset` от 0. Ответ `{ count, results }`, без `next`/`previous`. Страницы считаются из `count`, `limit`, `offset` (`pageInfo`). Фильтры и сортировка — свои у каждого endpoint, универсального формата нет.

### Деньги и даты — `lib/api/money.ts`, `lib/format.ts`, `lib/datetime.ts`

- Деньги — десятичная строка (`"1500.00"`) и отдельное поле `currency` (ISO). Во frontend сумма остаётся строкой; форматирование — `formatDecimalMoney` (Intl форматирует строку без перевода во float). Там, где интерфейс сам пересчитывает итог (демо-перенос сделки), — точная арифметика `lib/decimal.ts`.
- `*_at` — UTC ISO 8601; показываются в часовом поясе компании. `*_date` — `YYYY-MM-DD`.
- Поля ввода даты переводятся в ISO с учётом часового пояса компании (`companyWallTimeToIso`), а не браузера.

### Роли — `lib/permissions/backend-roles.ts`

Хранимые роли backend (`access_control/domain/rbac.py`, ветка P0) и роли интерфейса — только в `uiRoleFromBackend`, повторяет `PRODUCT_ROLES` backend:

| Backend | Интерфейс |
|---------|-----------|
| `owner`, `admin`, `director` | Директор |
| `manager` (устаревшее), `head_of_sales` | Руководитель отдела продаж |
| `sales_rep` | Менеджер |
| `lead_caller` | Первичная обработка лидов (рабочее пространство в продукте не описано — минимальный набор прав) |
| `operations` | Операционный отдел (то же) |
| `viewer` | Наблюдатель |

«Администратор платформы» — признак `is_platform_admin` в `/me/`, а не роль компании. Скрытие кнопок — только удобство: backend проверяет RBAC и область `own/team/all` на каждой операции. Список `permissions` из `/me/` frontend пока читает, но не использует для отображения — следующий шаг.

---------|-----------|--------|
| `owner` | Директор | предложение |
| `admin` | Директор | **уточнить**: это администратор компании? |
| `manager` | Руководитель отдела продаж | предложение (backend `manager` = руководитель) |
| `sales_rep` | Менеджер | предложение |
| `viewer` | Наблюдатель (только просмотр) | предложение |

«Администратор платформы» — не роль компании; как он определяется, нужно согласовать. Скрытие кнопок — только удобство: backend проверяет RBAC и область `own/team/all` на каждой операции и не отдаёт закрытые данные (пример — оценка звонка).

---

## Часть 2. Предложения (не согласовано)

Все схемы — в `features/*/schemas.ts`, имена полей ниже в `camelCase` (в API — `snake_case`).

### Вопросы к backend

1. **Capabilities.** Нужен ли список прав пользователя (`can_move_deal`, `can_assign_tasks`, `can_see_call_rating`…) в `GET /me/` или отдельным endpoint? Сейчас интерфейс выводит права из роли.
2. **Имя пользователя и компании.** `/me/` возвращает `username`; для шапки нужны ФИО, название компании и отдела.
3. **Хранение токенов** — выбрано: сервер Next.js держит токены в httpOnly-cookie, в backend уходят только Bearer-заголовки. Все запросы идут с сервера Next.js, CORS для браузера не нужен. Подтвердить у backend и уточнить:
   - поля тела логина (`username`, `password`?) и код ответа при неверном пароле;
   - срок жизни access и refresh, есть ли `exp` в токенах;
   - есть ли короткое окно, в котором старый refresh ещё принимается после ротации (нужно, если серверов Next.js будет несколько);
   - что backend делает при повторном использовании старого refresh (отзывает все сессии?).
4. **Поиск по клиентам** для форм (выбор лида при назначении встречи): endpoint с `search` и `limit`.
5. **Часовой пояс компании** — в данных компании или фиксированный.

### Сотрудники — `features/team` (подключено к P0)

**Модель доступа (согласована 01.11.2026, проверяет backend):** директор — вся компания; РОП — только свой отдел (`Membership.department`): сотрудники, задачи, планы и отсутствия его людей; число РОПов и город права не меняют. Нанимать и увольнять (создавать и отключать аккаунты) может только директор; механизма заявки РОПа с подтверждением директора пока нет. Имена коллег видят все: `GET /api/v1/staff/names/` → `[{ user_id, full_name }]`, только действующие сотрудники своей компании, без контактов и ролей. Подписи «ответственный» и «исполнитель» берутся оттуда; фильтры и выбор исполнителя — из `/staff/` (область роли).

`GET /api/v1/staff/` → `[{ id: user_id, name: full_name || login }]` без деактивированных. Id — пользователя, как `owner_user_id` у сделки и `manager_id` в фильтре. Менеджер (`sales_rep`) получает 403: фильтр по сотрудникам ему не показывается, имена в сделках не загружаются.

### Продажи — `features/sales` (подключено к P0, проверено 31.10.2026 на локальном backend)

Интерфейс работает со своими схемами (`features/sales/schemas.ts`), ответы backend переводит `features/sales/api/sales-repository.ts`.

- **Настройки воронок** — `GET /sales/pipelines/` (массив без пагинации) и `GET /sales/loss-reasons/?active=true` (`{count, results}`). Неактивные этапы скрываются, этапы — по `position`, воронка `is_default` — первой; воронка без активных этапов не показывается.
- **Доска** — отдельного endpoint нет: `GET /sales/pipelines/{id}/` и по запросу `GET /sales/deals/?pipeline_id&stage_id&status=open&limit=50` на каждый рабочий этап; `count` этапа — из ответа. **Суммы этапов backend не считает** — колонка показывает «—».
- **Таблица и «Список»** — `GET /sales/deals/` с `pipeline_id`, `stage_id`, `manager_id`, `search`, `attention`, `ordering`, `limit/offset`. Сортировка: `updated_at`, `amount`, `title` (± ). Сортировка по следующему шагу убрана: backend её не поддерживает и молча подставил бы сортировку по умолчанию.
- **Смена этапа** с доски в режиме api недоступна (`editMode = unavailable`), ничего не имитируется.

Пробелы backend (`DealReadSerializer`), поля остаются пустыми, а не придумываются:

| Нужно интерфейсу | Сейчас | Предложение |
|---|---|---|
| Клиент: имя и телефон | только `customer_id` | вложить `customer { id, name, phone }` в список сделок |
| «Обновлено» | нет `updated_at` в ответе (хотя сортировка по нему есть) | добавить `updated_at` |
| «На этапе с» | нет | `stage_entered_at` (есть в истории смены этапов) |
| Срок следующего шага и просрочка | `next_step` — только текст | `next_step_due_at`; `attention=overdue` сейчас значит «просрочена ожидаемая дата закрытия», а кнопка в «Списке» названа «Шаг просрочен» |
| Сумма по этапу | нет | `count` и `total_amount` по этапам одним запросом (`GET /sales/pipelines/{id}/board/`) |
| Имя ответственного | только `owner_user_id`, имена — через `/staff/` (менеджеру 403) | вложить `owner { id, name }` |
| Поиск | `title` и `source` | также телефон и имя клиента (подсказка в поле поиска это обещает) |

### Карточка лида — `features/leads/schemas.ts`

**Подключено к backend (31.10.2026, ветка backend `feature/deal-detail-embeds`):** `GET /sales/deals/{id}/` с вложенными `customer { id, name, email, phone } | null` (null — клиент не привязан или недоступен пользователю по правилам модуля клиентов) и `owner { id, name }`; воронка — `GET /sales/pipelines/{id}/`; «На этапе с» — последняя запись `GET /sales/deals/{id}/stage-history/`, без смен этапа — `created_at`. 404 (чужая или несуществующая сделка) → «Страница не найдена». Не отдаются и остаются пустыми: город клиента, метки, сводка ИИ, свои поля, другие сделки клиента; вкладка «Оплата» в режиме api скрыта, вкладки «Работа», «История», «Звонки» показывают «Раздел ещё не подключён».

`leadDetailSchema`: `id, title, client { name, phones[], email, city }, pipeline { id, name, stages[] }, stageId, manager, amount, currency, source, createdAt, stageEnteredAt, tags[], nextAction, aiContext { summary, nextSteps[], generatedAt } | null, payment { total, paid, remaining, currency, items[{ id, kind: prepayment|additional|full, amount, paidDate }] } | null, customFields [{ id, label, value }], related [{ id, title, pipelineName, stageName }]`.

Отдельные запросы (каждая вкладка загружается независимо):
- **История** `[{ id, at, kind: call|chat|note|stage|task|meeting|payment, title, body, author }]`, новые сверху.
- **Звонки** `[{ id, at, direction, durationSec, manager, summary, transcript[{ speaker, text }] | null, rating { score 1–5, comment } | null }]`. **`rating` backend отдаёт только руководителям**; демо-слой повторяет это правило.
- Задачи и встречи лида — списки модулей «Задачи» и «Встречи» с фильтром `lead_id`.

Не хватает полей (нужно решение): **документы** (файлы, договоры), **переписка** (мессенджеры), **запись звонка** (ссылка на аудио и права на прослушивание), **редактирование полей** и схема настраиваемых полей компании (типы, обязательность), **история изменений этапов** с автором, **связанные контакты** (несколько людей у одной сделки).

**Подключено (02.11.2026, `features/sales/actions.ts`, `features/sales/api/deal-mutations.ts`):** создание (`POST /sales/deals/`; кнопка «Новая сделка» на «Продажах»), правка (`PATCH /sales/deals/{id}/` с `version`; 409 → «сделку изменил кто-то другой»), смена этапа на доске и в карточке (`POST …/stage/` с `stage_id`; этап won/lost закрывает сделку, для lost — `loss_reason_id` из `GET /sales/loss-reasons/` и комментарий `reason`), повторное открытие (`POST …/reopen/`), передача (`POST …/assign/` `{owner_user_id}`), история (`GET …/history/` — действие, кто, когда, названия изменённых полей без значений), другие сделки клиента (`GET /sales/deals/?customer_id`), оплаты (`GET /payments/?deal_id`, внесение `POST /payments/` с `kind`, `paid_on`, `is_refund` и ключом `reference` против дублей). Итоги «оплачено / осталось» на frontend не считаются: продажи, оборот, получено и долг — `GET /payments/metrics/`. Блок «Что по сделке?» (сводка ИИ) в режиме api не показывается.

**Системные этапы и правила перехода (решение владельца 03.11.2026; backend `sales_pipeline` 0008):** у каждого этапа в ответе воронки есть `system_code` (`sale` | `meeting_rescheduled` | null) и `is_system`. «Продажа» (`sale`, вид won) есть в каждой воронке и всегда последняя: переименование, выключение, удаление и перестановка → 400 `system_stage_locked`; переход `POST …/stage/` на неё (и на любой другой этап вида won) и `POST …/win/` → 409 `sale_requires_payment` — интерфейс открывает внесение оплаты с чеком (`RecordSalePaymentDialog`), выигрыш ставит подтверждённая оплата. «Встреча перенесена» (`meeting_rescheduled`, вид open): название не меняется и этап не удаляется, но его можно передвинуть и выключить (`PATCH …/stages/{id}/ {is_active}`); переход требует `meeting_start`/`meeting_end` (иначе 400 `meeting_date_required`) и в той же транзакции переносит ближайшую встречу сделки (старая дата — в причине записи истории этапов) или назначает встречу ответственному. Переход на другой рабочий этап требует `next_step: {title, due_date, assignee_user_id?}`, если у сделки нет открытой задачи со сроком (иначе 400 `next_step_required`); задача создаётся в той же транзакции, по умолчанию — ответственному за сделку. Интерфейс сначала пробует переход без шага и спрашивает его только по коду `next_step_required`.

**Оплаты с чеком (решение владельца 03.11.2026; backend `payments` 0003, frontend `features/payments`):**
- `POST /payments/` — `multipart/form-data` через BFF `POST /payment-receipts`: `amount`, `currency?`, `kind` (`prepayment` | `full` | `additional`), `paid_on`, `deal_id`, `close_sale` (оплата внесена с этапа «Продажа»), `receipt` (PDF, JPEG, PNG, WEBP, HEIC до 10 МБ; обязателен, кроме возврата). Без чека → 400. Новая оплата `status: pending_verification`, в продажи, KPI и план не входит.
- `GET /payments/review/` — очередь «на проверке» (РОП — свой отдел, директор — компания; менеджер → 403). `POST /payments/{id}/confirm/`, `POST /payments/{id}/reject/ {reason}` — РОП или директор, не автор оплаты; исключение — единственный активный директор компании подтверждает собственные оплаты (в журнале `payment.self_confirmed`); повторное решение → 409. Подтверждение оплаты с `close_sale` закрывает сделку на «Продажа» (история этапов, аудит, событие `deal_won`).
- `GET /payments/{id}/receipt/` — файл чека (BFF `GET /payment-receipts/{paymentId}`), видимость — как у оплаты.
- `GET /payments/deals/{deal_id}/summary/` — цена сделки, получено (только подтверждённые), на проверке, долг, история оплат со статусом, загрузившим и датой загрузки чека. Возвраты — отдельные записи, история не удаляется.
- Проверка чека сейчас ручная (`ManualReviewVerifier`): автоматическое чтение суммы требует OCR / разбора PDF — зависимость не согласована.
- `GET /payments/metrics/`, факт планов и кабинет РОПа считают только `confirmed`.

### Задачи — `features/tasks/schemas.ts`

**Подключено (задачи сделки на карточке, только чтение):** `GET /activities/?kind=task&subject_type=deal&subject_id={id}` (P0). Видимость задаёт backend: менеджер — свои (владелец задачи = исполнитель), РОП — команды, руководитель — все. Перевод в интерфейс: срок — только дата (`due_date`, без времени), `is_overdue` и `due_group` (`overdue|today|this_week|later`; открытая без срока → `no_due`) считает backend по дню компании; `completed` → выполнено, `cancelled` не показывается; тип `follow_up|other` → «Задача»; приоритет `high|urgent` → «важная». Имена исполнителя и автора — из `/staff/`; менеджеру (403) известно только своё имя. Ограничение backend: не больше 2 открытых задач на сделку (409). Создание (`POST /activities/`, срок — дата, тип `call|meeting|other`, исполнитель — себе или, для РОПа и руководителя, активному сотруднику компании; 409 — лимит открытых задач) и выполнение (`POST /activities/{id}/complete/`, 409 — задача уже закрыта) подключены через server actions `features/tasks/actions.ts`. **С 02.11.2026 подключены также:** страница «Задачи» (`GET /activities/?kind=task&assignee_id&task_status`; название сделки — `GET /sales/deals/{id}/` по уникальным id страницы), правка задачи (`PATCH /activities/{id}/`: название, срок, приоритет, описание; тип backend не меняет — в форме поле заблокировано) и передача (`POST /activities/{id}/reassign/`). Создать задачу можно только из карточки сделки. Не подключено: поиск по задачам (у backend нет — поле скрыто в режиме api), «взять себе» (задача без исполнителя на backend не существует, фильтр «Без исполнителя» честно пуст).

`taskSchema`: `id, title, description, type (call|meeting|email|todo), priority (high|normal), status (open|done), dueAt | null, isOverdue, dueGroup (overdue|today|tomorrow|this_week|next_week|later|no_due) | null, assignee | null, createdBy, lead { id, name } | null, completedAt, result`.
**Просрочку и группу срока считает backend** в часовом поясе компании. Список: `{ count, results }`, фильтры `status` (open|done|all), `assignee_id` (или «без исполнителя»), `lead_id`, `search`. «Мой день» использует `{ date, tasks, overdueFromPreviousDays }`.

Нужны операции: создать, изменить, выполнить с результатом, взять задачу без исполнителя. Правило «не больше 2 открытых задач на сделку» проверяет backend (`validation_error`).

### Встречи — `features/meetings/schemas.ts`

`meetingSchema`: `id, startsAt, endsAt | null, lead { id, name }, format (office|online|visit), location, host (проводит), bookedBy (назначил), status (scheduled|confirmed|held|no_show|rescheduled|cancelled), clientConfirmation (confirmed|not_confirmed|not_sent), outcomeRequired, notes, outcomeComment`.
Фильтры: `period` (yesterday|today|tomorrow|week — границы дней на backend) или произвольный интервал (уточнить формат), `status`, `host_id`, `lead_id`, `search`, `outcome_required`.
Нужны операции: назначить, записать итог (`held|no_show|rescheduled` + новая дата и комментарий), отменить. `outcomeRequired`, напоминания (за 24 ч и 2 ч) и списание через 14 дней — на backend.

**Подключено (02.11.2026):** список `GET /meetings/` (`period` → `date_from/date_to` в днях компании, ведущий → `owner_id`, лид → `subject_type=deal&subject_id`, `status`), назначение `POST /meetings/` (по сделке, длительность 60 мин — в форме её нет) и итог `POST /meetings/{id}/outcome/` (перенос — с новой датой). Перевод: `scheduled` + `confirmed_at` → «подтверждена»; `outcomeRequired` = запланирована и время окончания прошло — **считает frontend по ответу**, т. к. backend флага не отдаёт (фильтр «Без итога» уточняется в пределах страницы до 100 встреч); «подтверждение не отправлялось» backend не хранит — без `confirmed_at` показывается «не подтвердил». Не подключено: поиск (нет у backend), отмена и ручное подтверждение в интерфейсе.

Итог `no_show` требует `reason` (иначе 400 `no_show_reason_required`). Итог `rescheduled` требует `new_start` и `new_end` (иначе 400 `meeting_date_required`): перенос без даты больше не сохраняется (решение владельца 03.11.2026). Итог `held` для встречи по сделке или клиенту принимает `next_step` (задача: название, срок) и требует его, если открытой задачи со сроком нет (400 `next_step_required`); то же для `POST …/complete/`. В «Итоге встречи» и «После встречи» поля следующего шага уходят вместе с итогом — задача создаётся в той же транзакции.

### После встречи — `features/after-meeting/schemas.ts`

**В режиме api (02.11.2026) очередь собирается на frontend из данных backend, пока нет отдельного endpoint:** встречи без итога (`scheduled`, окончание прошло; все страницы `GET /meetings/`) и состоявшиеся за 14 дней (`status=held`), по одной последней на сделку; состояние сделки — `GET /sales/deals/{id}/` (только открытые). Группы: «Нужен итог», «Нет следующего шага» (`next_step` пуст), «Ждём решения» (`next_step` указан). Обработка — три запроса: итог `POST /meetings/{id}/outcome/` (договорённости — в комментарий), задача `POST /activities/` и следующий шаг `PATCH /sales/deals/{id}/` (с `version`). **Нужен endpoint очереди** с группами, посчитанными на backend, и обработка одной транзакцией — см. блокеры в `docs/FRONTEND_IMPLEMENTATION_AUDIT.md`.

Очередь: `{ groups: [{ id: outcome_required|no_next_step|awaiting_decision, title, description, items }] }`. Элемент: встреча (`id, startsAt, format, host, outcomeComment`), лид (`id, name, phone`), воронка, этап, сумма, текущий следующий шаг, `aiHint`. **Группы раскладывает backend.**
Нужна операция «обработать после встречи»: итог (если не записан: `held|no_show|rescheduled` + новая дата), краткий итог, договорённости, следующий шаг (создаёт задачу). Один запрос или два (итог встречи + задача) — решить с backend.

### Распределение лидов — `features/lead-routing` (решение владельца 03.11.2026)

`GET|PUT /leads/routing/` — правило отдела. `PUT`: `enabled`, `member_ids` (пусто — все менеджеры отдела), `require_on_shift`, `skip_on_absence`, `is_company_intake?`. Ответ: те же поля плюс `department_id`, `last_assigned_user_id`, `updated_by`, `updated_at`, `is_default` и `candidates[]` (`user_id`, `full_name`, `selected`, `on_shift`, `absent`, `eligible` — «получит лид» по текущему состоянию). Распределение по кругу (round-robin) только среди активных менеджеров продаж отдела, которые на смене и не в отсутствии (лидорубы не участвуют; `require_on_shift: false` и `skip_on_absence: false` → 400, во frontend эти поля не передаются; выключить распределение можно через `enabled`); лиды, созданные менеджером, остаются у него; если подходящих нет — лид остаётся у создателя, РОП получает уведомление. Изменять — РОП (свой отдел) и директор; страница `/settings/lead-routing`.

### Заявки с сайта — `features/web-forms` (требование 9.1)

Ключи формы ведут директор (любой отдел) и РОП (свой отдел): `GET /web-forms/keys/?department_id=`, `POST /web-forms/keys/ {name, department_id?}`, `POST /web-forms/keys/{id}/revoke/`; ключ: `{id, name, department_id, department_name, token, endpoint_path, is_active, created_by, created_by_name, created_at, revoked_at, last_used_at, leads_count}`. Сайт отправляет без авторизации (CORS открыт только для этого пути) `POST /public/leads/{token}/ {name, phone?|email?, comment?, page_url?, utm_source?, utm_medium?, utm_campaign?, website (ловушка, пусто)}` → 202 `{"status":"accepted"}` (также при ловушке и повторе того же контакта по ключу за 10 минут — без нового лида); 404 — неизвестный или отозванный ключ, приостановленная компания; 403 `subscription_inactive`; 400; 413 (тело больше 16 КБ); 429 (10/мин на IP, 120/мин на ключ). Местный номер читается по стране компании (KG, KZ, RU, UZ). Лид создаётся обычным захватом с источником `website` — действует распределение отдела; комментарий, страница и UTM — заметкой «Заявка с сайта»; в журнале `web_form.lead_received`.

### Импорт сделок — `features/imports` (требование 20.5)

`POST /imports/preview/` и `POST /imports/` с `entity: "deals"` (CSV до 2000 строк / 2 МБ). Колонки (рус./англ.): Сделка (обязательно), Сумма, Валюта, Воронка, Этап, Ответственный (логин или e-mail; менеджер — только себе, РОП — в своём отделе), Клиент + Телефон/E-mail (найденный клиент привязывается, иначе создаётся), Дата закрытия, Источник, Следующий шаг + Срок шага, Причина проигрыша. Строка `invalid`: этап won (в т. ч. «Продажа»), «Встреча перенесена», lost без причины, следующий открытый этап без следующего шага. Каждая строка создаётся сервисами сделок в своей транзакции. Строки предпросмотра несут объект `deal`. Лимиты тарифа (клиенты, сделки) проверяются построчно для всех импортов: строка сверх лимита — «Достигнут лимит тарифа компании». Право — `deals.create`.

### Автоотчёты — `features/company-settings`, `features/notifications`

`GET/PATCH /company/`: `morning_report_enabled`, `morning_report_time`, `evening_report_enabled`, `evening_report_time` ("HH:MM" по часовому поясу компании; по умолчанию включены, 09:00 и 19:00; менять может только директор). Каждые 5 минут задача `notifications.daily_reports` создаёт уведомления категории `report` (в течение 3 часов после назначенного времени, не больше одного отчёта каждого вида в день на человека): утром — менеджеру задачи, встречи, просрочка и сделки без следующего шага; РОПу — сводка отдела; директору — по отделам; вечером — итоги дня (деньги — только подтверждённые оплаты в валюте компании) и менеджеры без активности. РОП (без РОПа — директор) получает отдельное уведомление `inactivity`. Отсутствующие и уволенные ничего не получают. Категории `report` и `inactivity` отключаются в `/notifications/preferences/`. Email и Telegram не подключены.

### «Что делать сегодня» — `features/team-cabinet`

`GET /team/today/?date=ГГГГ-ММ-ДД` — доска прошедшего дня (например, вчера: кабинет показывает её утром, пока сегодня оценок нет); дата в будущем — 400. В ответе `date` — день доски, у менеджера и в итогах `prepayments` — сколько из оплат дня предоплаты.

`GET /team/today/?include=actions[&actions_limit=1..50][&department_id=]` — кроме доски дня возвращает `actions` с восемью группами в постоянном порядке: `payments_to_verify`, `overdue_tasks`, `tasks_due_soon`, `meetings_without_outcome`, `deals_without_next_step`, `deals_to_push`, `leads_without_contact`, `managers_without_activity`. У группы: `kind`, `title`, `rule`, полный `count`, `by_manager`, `amounts` по валютам (не суммируются между валютами) и до `actions_limit` элементов (по умолчанию 5). Оплачено и долг — только подтверждённые оплаты в валюте сделки. Пороги — в `thresholds` (застой сделки — настройка компании, по умолчанию 14 дней; первый ответ на лид — 15 минут). РОП — свой отдел, директор — компания или `department_id`, остальные — 403. Модуль operations по тарифу не требуется.

### База клиентов — `features/clients/schemas.ts`

Клиент — человек или компания с одной или несколькими сделками (в том числе закрытыми). Отдельной сущности в контракте пока нет.
Список: `{ id, name, phones[], email, city, manager, openDealsCount, dealsCount, currentDeal { id, stageName } | null, lastInteractionAt }`; фильтры `search` (имя и телефон по всей истории, включая архив; телефон — по цифрам), `status` (`active` — есть открытая сделка, `archive`), `manager_id`. Детали: + `deals[]` (`id, title, pipelineName, stageName, stageKind, amount, currency, updatedAt`) и `recentActivity[]`.
Вопросы: как backend склеивает дубли (один телефон — разные имена), есть ли у клиента собственные поля (компания, ИНН), отдельная карточка клиента или достаточно панели.

**Подключено (02.11.2026):** `GET /customers/` (`search`, `owner_id`, `archived=true|false|all`), сделки клиента — `GET /sales/deals/?customer_id`, история — `GET /activities/?subject_type=customer`; создание (`POST /customers/`), архив и возврат (`/archive/`, `/restore/`), передача (`/assign/`, РОП — в своём отделе) и новая сделка клиенту (`POST /sales/deals/` с `customer_id`; каждая новая сделка — отдельная продажа после первой оплаты). Фильтр «Активные» = не в архиве. `lastInteractionAt` — последнее движение по сделкам клиента; `city` backend не хранит.

### Звонки — `features/calls/schemas.ts`

`{ id, at, direction (incoming|outgoing), status (answered|missed), durationSec, phone, lead | null, manager, hasRecording, transcript[{ speaker, text }] | null, analysis { summary, agreements[], objections[], nextAction, generatedAt } | null, rating { score 1–5, comment } | null }`.
Фильтры: `direction`, только пропущенные, `manager_id`, `lead_id`, `search` (клиент, номер). **`rating` — только руководителям**, остальным backend отдаёт `null` (демо-слой повторяет правило — проверено: у менеджера оценки нет даже в HTML).
Вопросы: ссылка на запись и права на прослушивание; когда появляется `analysis` (задержка обработки); порог «от 30 секунд» — на backend.

### Область видимости — обязательное требование к backend

Для роли `sales_rep` все списки и карточки (сделки, задачи, встречи, звонки, клиенты, «Фокус», «После встречи») возвращают только записи сотрудника; чужая запись по id — 404. Параметры фильтра по сотруднику (`manager_id`, `host_id`, `assignee_id`) для менеджера игнорируются. Список коллег со счётчиками («Фокус» → `managers`) менеджеру не отдаётся. Демо-слой (`mocks/scope.ts`) повторяет это правило.

### «Мой день» менеджера — `features/my-day/schemas.ts`

Только для текущего пользователя (из токена), без параметра «чей».
- **Месяц** `myMonthSchema` (`month=YYYY-MM`, один запрос на страницу): `period { month, label, isCurrent, workDaysTotal, workDaysLeft }`; `now` (только текущий месяц) `{ awaitingReply { count, longestWaitWorkMinutes }, meetingsToday { held, total }, meetingsWithoutOutcome, reschedulesWithoutDate, tasks { overdue, dueToday } }`; `turnover { fact, target, expectedToDate, forecast, progress, expectedProgress, growth { amount, comparedTo }, prepayments, additionalPayments, note }`; `earnings { total, notice, lines[{ label, amount, note }], footnote } | null`; `kpis { sales { count, growth, comparedTo, planNote }, salesPerMeeting { ratio, sales, held, bonusThreshold }, averageDeal { amount, note }, meetingsHeld { count, attendance, upcoming } }`; `monthFunnel { assigned, passed, held, sales, upcoming }`; `daily[{ date, cumulative, plan, turnover, sales }]`; `segments[{ id, name, sales, previousSales, turnover, prepayments, additionalPayments, averageDeal, share }]`. Деньги — десятичные строки и `currency`. **Все расчёты (рабочие дни, план к дню, прогноз, заработок) — backend.** Нет данных за месяц — `null` (или 404).
- **Дела на сегодня** `todayActionsSchema`: `asOf`, `actions[{ id, kind (reply | overdue_task | meeting_outcome | confirm_meeting | no_next_step | stale_deal), urgency (now | today | soon), lead { id, name }, problem, detail, at, amount, currency }]`. Отбор, срочность и порог «давно без движения» — правила backend; один пункт на клиента.
- Расписание дня — существующие «Встречи» (`period=today`) и «Задачи на сегодня»; сделки в фокусе — «Фокус» (добавлены `amount`, `currency`).

**В режиме api (02.11.2026)** вместо макета показывается то, что backend уже отдаёт (`features/my-day/components/server-my-day.tsx`): рабочая смена (`GET /work-sessions/current/`, `POST /work-sessions/start|stop/`), личные планы текущего периода (`GET /plans/progress/?scope=user&scope_id`), счётчики задач на сегодня и просроченных (`/activities/` с `due_from/due_to`, `overdue=true`) и встреч сегодня. Месяц из макета (оборот, заработок, KPI, направления) и «Дела на сегодня» ждут endpoint.

### Кабинет РОПа — `features/team-cabinet/schemas.ts`

Доступ — роли РОП, директор, админ; остальным 403. Числа — детерминированно (SQL), совпадают с «Отчётами дня», «Встречами», «Звонками».
- **Сегодня** `teamTodaySchema`: `asOf` («данные на HH:MM»), `workDay { number, total, monthLabel }`, `attention[{ id, priority, manager, problem, value, target }]`, `rows[{ manager, level (green|yellow|red), reasons[], absence { kind, label, until } | null, inactiveDays, dayScore (2–5 | null), today { meetings { total, confirmed, toConfirm, nextToConfirmAt, held, noShow, rescheduled, cancelled, withoutOutcome }, payments { count, amount, currency }, calls { total, answered, conversations, minutes }, waitingReplies { count, maxWaitHours }, tasks { today, overdue, unassigned }, hygiene { withoutOutcome, rescheduledNoDate, noNextStep } }, plan }]`, `department { today, plan }` — агрегат backend.
- **План** `planSchema`: `target | null` (план продаж — клиенты с первым платежом), `fact`, `remaining`, `workDaysTotal`, `workDaysLeft`, `expectedToDate`, `perDayNeeded`, `forecast` (линейный), `meetingsHeldNeeded`, `meetingsToBookNeeded`, `meetingToSale`, `attendance`.
- **Встречи и звонки** `teamQualitySchema` (`period=week|month`): итоги встреч, `heldWithoutSale[]`, `calls[{ manager, total, conversations, rated, avgScore, goalAchievedShare, nextStepShare }]`, `toListen[{ callId, lead, manager, score, kind (weak|strong), summary }]`. Причины отмен — нужны.
- **Воронка** `teamFunnelSchema`: по этапам `count`, `amount`, `medianAgeDays`, `staleCount` (дольше `staleThresholdDays`), `conversionToNext | null`, `isPile`. Без истории переходов конверсия = null.
- **Карточка менеджера** `memberCardSchema` (14 дней): `dayScores[]`, `plan`, оплаты, `activity[{ date, calls, conversations, isWorkDay }]`, `discipline`, `callQuality { rated, total, distribution, goalAchievedShare, nextStepShare, gaps[] } | null`, `focusPoints[]` (правила, не ИИ), `dealsToPush[]`, `toListen[]`.
- **Звонки:** в разбор добавлен признак `goal` (achieved | partial | missed) — «цель звонка да/частично/нет» из ТЗ.

**В режиме api (02.11.2026)** кабинет показывает только то, что считает backend (`features/team-cabinet/components/server-cabinet.tsx`): «Сегодня» — `GET /team/today/` (светофор и причины backend, встречи, звонки, оплаты, получено, задачи) и «План — факт» — `GET /team/plan-fact/` (план продаж, продажи, осталось, линейный прогноз, получено). Вкладки «Встречи и звонки», «Воронка» и карточка менеджера — до появления endpoint.

**Также подключено (02.11.2026):** вкладка «Планы» — `GET /plans/progress/?period` (план, факт, процент, остаток — backend), форма `PUT /plans/` (уровень, кому, показатель, месяц, цель), история `GET /plans/{id}/history/`; вкладка «Тишина и отсутствия» — `GET /team/inactivity/`, `GET /absences/?active_from&active_to`, `POST /absences/` (отпуск, больничный, отгул, командировка, «не вышел без предупреждения»); выгрузка KPI — `POST /analytics/reports/` (`kpi_summary`, `csv`, `idempotency_key`) → опрос `GET /analytics/reports/{id}/` → скачивание через BFF `GET /exports/{id}` (`GET /analytics/reports/{id}/download/`). В «Моём дне» — показатели месяца `GET /payments/metrics/` с определениями backend.

Не подключено (нужны контракты): «Срез на планёрку» и отправка в Telegram, задание планов (форма и история), график отсутствий с типами, выгрузки без телефонов, итоги one-to-one (P2), калибровка оценок ИИ.

### Сотрудники, отделы и заявки на найм — `features/staff` (подключено, 01.11.2026)

Публичной регистрации нет. Аккаунты создаются внутри системы по иерархии; какие роли можно выдать, сервер отдаёт в `create-options`.

| Кто | Что может | Как |
|-----|-----------|-----|
| Администратор платформы | Компанию и её первого директора | `POST /api/v1/platform/companies/` (см. «Платформа») |
| Директор | РОПов и других сотрудников своей компании, отделы | сразу: `POST /api/v1/staff/`, `POST /api/v1/departments/` |
| РОП | Менеджера (`sales_rep`) или лидоруба своего отдела; отключение и сброс пароля сотрудника своего отдела | **сразу** (с 02.11.2026, `create-options.can_create_directly`): `POST /api/v1/staff/`, `POST /staff/{id}/deactivate/`, `POST /staff/{id}/reset-password/`; заявки директору остаются только для истории |
| Менеджер, наблюдатель | — | 403 |

Endpoint (все с `X-Tenant`):
- `GET /api/v1/staff/` — сотрудники в области: директор — компания, РОП — свой отдел. `{ count, results: [{ id (membership), user_id, login, full_name, role (backend), department {id,name,is_active} | null, status: active|invited|deactivated, created_by (user id) | null, created_at }] }`.
- `GET /api/v1/staff/create-options/` — `{ creatable_roles[], departments[], fixed_department_id | null, mode: "direct" | "request" }`.
- `POST /api/v1/staff/` (директор) — `{ first_name, last_name?, role, login?, department_id? }` → 201 `{ member, temporary_password }`. Пароль генерирует сервер и возвращает один раз.
- `GET|POST /api/v1/staff/requests/` — заявки (директор — все, РОП — своего отдела). Найм: `{ kind: "hire", first_name, last_name?, role, login? }` — отдел берётся из членства РОПа, переданный игнорируется; увольнение: `{ kind: "dismiss", membership_id, reason? }`.
- `POST /api/v1/staff/requests/{id}/approve/` (директор) → `{ request, temporary_password? }` — найм создаёт аккаунт, увольнение отключает его; `…/reject/` `{ note? }` (директор); `…/cancel/` (автор). Повторное решение — 409. Вторая заявка на увольнение того же сотрудника, пока первая ждёт, — 409.
- Увольнение (одобренная заявка или `POST /api/v1/staff/{id}/deactivate/` директора): вход блокируется (токены сотрудника → 401), аккаунт и все записи сохраняются. **Открытые задачи** уволенного переходят к РОПу, подавшему заявку, или к директору, отключившему аккаунт напрямую (запись `activity.tasks_handed_over` в журнале). Сделки и клиенты остаются за сотрудником как история; директор передаёт их через `…/assign/`. Выполненные задачи и встречи не меняются.
- Также: `PATCH /api/v1/staff/{id}/ { role?, department_id? }` (смена роли; перевод между отделами — только директор), `POST /api/v1/staff/{id}/reset-password/` → `{ temporary_password }` (директор — всем, РОП — сотрудникам своего отдела), `POST /api/v1/auth/password/change/` (своя смена). Восстановления пароля по e-mail/SMS нет — нет инфраструктуры доставки.
- `POST /api/v1/departments/` (директор) — `{ name }` → 201.

В интерфейсе: директор создаёт отделы на странице «Компания», РОПов и сотрудников — в «Сотрудниках» и одобряет заявки там же (пароль нового сотрудника показывается при одобрении один раз). РОП отправляет заявку и может отозвать свою. Заявка на увольнение пока доступна только через API (кнопки в списке нет). В демо-режиме заявки и отделы не сохраняются.

### Платформа — `features/platform` (подключено, 01.11.2026)

Только для `is_platform_admin` (проверяется backend на каждом запросе; директор компании получает 403). Без `X-Tenant`.
- `GET /api/v1/platform/overview/?period_days=7|30|90|365&plan=trial|free|pro|enterprise` — `plan` (необязательный) сужает компании, пользователей, подписки и обращения до компаний этого тарифа, технические ошибки остаются по всей платформе; `revenue.by_plan` — по каждому тарифу каталога число подписок с доступом и сумма их цен в месяц. Компании, пользователи, подписки по состояниям; `revenue.assigned_monthly` — **сумма прейскурантных цен назначенных тарифов, не полученные деньги**; `revenue.received` — сумма **подтверждённых** платежей за подписки с `paid_on` в периоде, по валютам; `revenue.overdue` — `null` (`overdue_unavailable_reason`): для задолженности нужны выставленные счета, их платформа не ведёт.
- Платежи за подписки (ручной учёт, без платёжного провайдера):
  - `GET|POST /api/v1/platform/companies/{id}/payments/` — `{ amount, currency, paid_on, reference, period_start?, period_end?, note?, confirm? }`. `reference` — номер внешней операции (банковский перевод, квитанция), уникален: повтор → 409 `duplicate_payment`. Дата в будущем → 400. Новый платёж `pending` и в выручку не входит; `confirm: true` — записать и подтвердить сразу.
  - `POST /api/v1/platform/payments/{id}/confirm/`, `…/cancel/ { note? }` — только из `pending`; повторное решение → 409 `payment_invalid_state`.
  - `GET /api/v1/platform/payments/?status&company_id&paid_from&paid_to` — история по всем компаниям.
- `GET /api/v1/platform/catalog/` — тарифы (`trial` «Пробный 7 дней», $0, `trial_days: 7` — без даты окончания подписка заканчивается на 7-й день; `free` «Standard», `pro` «Pro», `enterprise` «Premium») с ценой и модулями по умолчанию; список модулей.
- `GET /api/v1/platform/companies/?search&status=active|suspended&plan&access=active|expiring|expired|past_due|cancelled&limit&offset`.
- `POST /api/v1/platform/companies/` — `{ name, slug, country, currency, timezone, subscription: { plan_code, starts_on, ends_on?, features?, status? }, director: { first_name, last_name?, login?, email?, phone? } }` → 201 `{ company, director: { login, temporary_password } }`. Компания, директор, подписка, отдельная база данных и стандартная воронка создаются одной операцией; при ошибке ничего не остаётся. Если на сервере выключено `TENANT_PROVISIONING_ENABLED` — 409 `provisioning_disabled`.
- `GET|PATCH /api/v1/platform/companies/{id}/` — карточка (директора, история изменений) / `{ name?, is_active? }` (приостановить — сотрудники компании теряют доступ).
- `PUT /api/v1/platform/companies/{id}/subscription/` — `{ plan_code, starts_on, ends_on?, features[], status }`: тариф, срок (последний день включительно) и модули.
- `GET /api/v1/platform/errors/?status`, `PATCH …/errors/{id}/ { status }` — непредвиденные ошибки сервера (500) и окончательно упавшие фоновые задачи Celery (`method: "TASK"`, `route` — имя задачи): компонент, тип исключения, код запроса, компания (если задача получает `tenant_slug`); без текста ошибки, аргументов и данных запроса.
- `GET /api/v1/platform/tickets/?status`, `GET|PATCH …/tickets/{id}/ { status?, internal_note? }`.

Подписка компании проверяется на каждом запросе с `X-Tenant`: истёкшая или отменённая — 403 `subscription_inactive` (кроме `/subscription/` и `/support/`), модуль вне подписки (`/telephony/`, `/communications/`, `/payments/`, `/analytics/`, `/ai/`, `/operations/`, `/risk/`) — 403 `feature_not_in_plan`. Интерфейс показывает для этих кодов отдельные сообщения.

### Поддержка — `features/support` (подключено, 01.11.2026)

`GET|POST /api/v1/support/tickets/` (X-Tenant) — `{ kind: question|problem|feedback|idea, subject, body }`; сотрудник видит только свои обращения, без внутреннего комментария платформы.

### Ядро CRM на backend (реализовано 01.11.2026, frontend подключит отдельной задачей)

Все операции — с `X-Tenant`, права проверяет backend (роль + область own/team/all). Связать работу можно только с записью, **которую пользователь видит**: сделка с клиентом, задача/звонок/заметка с клиентом/сделкой/лидом, встреча с клиентом/сделкой — иначе 404 (как будто записи нет).

**Клиенты** (`/api/v1/customers/`):
- `GET ?search&owner_id&archived=false|true|all&ordering=name|created_at|-…&limit&offset` — по умолчанию только активные. В ответе добавлены `team_id`, `archived_at`.
- `POST`, `GET|PATCH {id}/` (оптимистическая блокировка `version` → 409). E-mail уникален в компании (409); телефон — нет.
- `POST {id}/archive/`, `{id}/restore/` — архив: скрыт из списка, только чтение (правка → 409 `customer_archived`), новые сделки на него → 400; сделки и история сохраняются.
- `POST {id}/assign/ { owner_user_id }` — смена ответственного: менеджер не может (403), РОП — внутри своего отдела, директор — любому активному сотруднику компании; чужой компании или отключённому → 400. Отдел нового ответственного становится отделом клиента.
- Связанные сделки — `GET /api/v1/sales/deals/?customer_id=`; история — `GET /api/v1/activities/?subject_type=customer&subject_id=`.

**Сделки** (`/api/v1/sales/deals/`) — к существующим списку (фильтры, сортировка, пагинация), созданию, карточке, правке, переводу этапа, win/lose/reopen и `stage-history/` добавлены:
- `POST {id}/assign/ { owner_user_id }` — смена ответственного по тем же правилам, что у клиентов; работает и для закрытых сделок.
- `GET {id}/history/` — `{ count, results: [{ action, occurred_at, actor {id,name}, changed_fields }] }`, новые сверху: `deal.created|updated|stage_changed|won|lost|reopened|reassigned`; в `changed_fields` — имена полей (`title`, `amount`, `customer`, `source`, `next_step`, `custom_fields`, `expected_close_date`, `owner`), значения не раскрываются.
- Закрытие — только через выигрыш/проигрыш (отдельного «архива» сделок нет); перевод на этап — только `POST {id}/stage/`, этап проверяется на принадлежность воронке сделки и активность.

**Воронки** (`/api/v1/sales/pipelines/`, менять может право `pipelines.manage`: директор; у РОПа оно сейчас тоже есть — открытый вопрос):
- `PATCH {id}/ { name?, is_default: true? }` — переименовать или сделать воронкой по умолчанию.
- `POST {id}/stages/ { name, probability, kind: open|won|lost, position? }` → 201, вставка со сдвигом.
- `PATCH {id}/stages/{stage_id}/ { name?, probability?, is_active? }` — `is_active: false` архивирует этап: он остаётся в истории и на закрытых сделках, но переводить на него нельзя; этап с открытыми сделками архивировать нельзя (409 `stage_in_use`); в воронке всегда есть хотя бы один активный открытый этап. Тип этапа (`kind`) не меняется.
- `PUT {id}/stage-order/ { stage_ids }` — новый порядок всех этапов (каждый ровно один раз, иначе 400).
- Новая компания получает «Основную воронку»: Новый 10 % → Квалификация 30 % → Предложение 60 % → Выиграна → Проиграна.

**Задачи и встречи** — жизненный цикл уже был: задачи — создание, правка (срок, приоритет), `reassign/`, `complete/ {result}`, `cancel/`, `reopen/`, не больше двух открытых задач на сделку (409); встречи — создание, правка, `reschedule/`, `confirm/`, `cancel/`, `complete/`, `outcome/`, участники. Изменено только правило связей (см. выше).

**Планы: выполнение** — `GET /api/v1/plans/progress/?scope&scope_id&metric&period&limit&offset`. Те же права, что у списка: менеджер — свои планы, РОП — план компании, своего отдела и его сотрудников, директор — все, наблюдатель — 403. Каждая строка — план плюс `period_start`, `period_end`, `unit` (`count|money`), `currency` (для денег), `actual`, `percent` (`actual / target × 100`, одна цифра после точки; `null`, если цель 0).

| Метрика | Факт | Источник |
|---|---|---|
| `monthly_sales` | сделки, чей **первый** платёж (не возврат) пришёлся на месяц; продажа засчитывается продавцу первого платежа | платежи по сделкам |
| `monthly_turnover` | платежи за месяц минус возвраты, только в валюте компании | платежи |
| `weekly_leads` | лиды, созданные за ISO-неделю | лиды (ответственный) |
| `weekly_prepayments` | число предоплат (`kind=prepayment`, не возвраты) за неделю | платежи |
| `daily_calls` | звонки, записанные за день (действия `call`) | действия (ответственный) |

План сотрудника — его результаты; план отдела — результаты **текущих** сотрудников отдела (кто продал, а не кто внёс платёж); план компании — все. Дни — в часовом поясе компании.

### «Фокус», рабочее пространство

**Подключено (02.11.2026):** `GET /operations/findings/` (модуль `operations`, тариф Enterprise; иначе 403 `feature_not_in_plan` — показывается сообщение о тарифе). Группы — виды правил backend: `overdue_task`, `stale_lead`, `deal_without_next_step`, `stalled_deal`; порядок — как у backend (старые первыми), пороги — `thresholds`. Названия: сделки `GET /sales/deals/{id}/`, лиды `GET /leads/{id}/`, задачи `GET /activities/{id}/` (до 25 строк на группу). Приоритета, «ждут ответа», последнего касания и рекомендации ИИ backend не отдаёт — поля пустые (`priority: null`, `awaitingReply: null`). «Отложить» и «Убрать из фокуса» в режиме api скрыты: операций нет. `focusListSchema` (+ `amount`, `currency`, `href` у элемента). Раскладка рабочего пространства убрана вместе со старой главной; вернётся отдельным контрактом, когда будет утверждена настройка РОПом.

## Изменения 05.11.2026 (замечания владельца)

- `POST /activities/` с `kind=task` можно отправить без `subject_type`/`subject_id`: задача сотруднику без сделки и клиента. В ответе `subject_type: "member"`, `subject_id` — исполнитель (при передаче задачи меняется вместе с ним). Звонку и заметке привязка по-прежнему нужна.
- `POST /leads/` принимает `owner_user_id`: РОП или директор сразу выбирает ответственного (правило как у передачи лида), автораспределение тогда не срабатывает.
- `POST /leads/{id}/convert/`: в `create_deal` добавлены `stage_id` (рабочий этап воронки, обычные правила этапов) и `next_step` `{title, due_date}` — задача следующего шага по сделке. Сделка достаётся ответственному за лид. Интерфейс без шага не конвертирует.
- `GET /sales/deals/?closed_from=ГГГГ-ММ-ДД` и `ordering=-closed_at` — продажи месяца (колонка «Продажа» на доске).
- Сделка в списке и карточке отдаёт `next_task` `{title, due_date}` — ближайшую открытую задачу со сроком (это и есть следующий шаг); `attention=no_next_step` такие сделки не показывает.
- Примечания к входящему лиду — заметки `kind=note` с `subject_type=lead`.
- Продукты компании: `GET/POST /sales/products/`, `PATCH /sales/products/{id}/` — `{id, name, is_active, show_on_my_day}`. Видят все, ведут директор и РОП (`pipelines.manage`); продукты отключаются, не удаляются. Сделка: `product_id` в `POST/PATCH /sales/deals/`, в ответе сделки и в `create_deal` при конвертации лида; неактивный или чужой продукт — 400.
- Оклад и процент: `GET /plans/compensation/` и `PUT /plans/compensation/{user_id}/` `{base_salary, commission_percent}` — только директор (`company.settings.manage`), валюта компании, процент 0–100, не сотрудник — 404.
- `GET /team/my-month/?month=ГГГГ-ММ` — свой месяц сотрудника: `sales`, `previous_sales`, `new_clients`, `turnover`, `debt`, `average_check`, `money {prepayments, additional, full, refunds, received}` (подтверждённые оплаты месяца), `targets {sales, turnover}`, `meetings {assigned, passed, ahead, held, attendance_percent, sales_per_meeting_percent}`, `earnings {base_salary, commission_percent, commission, total}` (null, пока директор не задал условия; процент — от `received`) и `products[]` (продукты с `show_on_my_day`: продажи, прошлый месяц, оборот, деньги, средний чек).
- `GET /team/my-focus/?actions_limit=N` — «Фокус» менеджера: группы в формате `actions` доски дня, порядок `miss_tasks` (открытые задачи типа `review` — «по проколу»), `overdue_tasks` (без них), `deals_to_push`, `debts_to_collect` (открытые и выигранные сделки с подтверждёнными оплатами меньше суммы), `leads_without_contact`, `meetings_without_outcome`, `deals_without_next_step`. Свои записи, не зависит от тарифа операций.
- Задача «по проколу» — `POST /activities/` с `task_type=review` (ставит руководитель).

## Чаты (боковая панель)

Список — `GET /communications/conversations/?channel=whatsapp`, раз в 15 секунд, пока вкладка на экране: push-событий нет.

Состояние номера — `GET /communications/whatsapp/status/`, только при загрузке страницы и после подключения: запрос идёт к провайдеру, поэтому в опрос он не входит.

Кнопка «Подключить WhatsApp» (директор и РОП) показывает `GET /communications/whatsapp/qr/` и опрашивает его раз в 3 секунды. Права проверяет backend: `communications.connect`.

Окно чата: `GET conversations/{id}/`, `GET .../messages/`, `POST .../messages/`, `POST .../assign/`, `read/`, `close/`, `reopen/`. Открытый чат опрашивается раз в 5 секунд и при открытии считается прочитанным. Сообщения читаются страницами от старых к новым, до 1000 штук: у ответа нет `count`, поэтому для длинных чатов нужна выдача с конца.

Файлы чата: у сообщения поле `attachment`, сам файл идёт через BFF `/chat-attachments/{chatId}/{messageId}` к `GET conversations/{id}/messages/{messageId}/attachment/`. Фото, голосовые и видео показываются в окне чата, документы скачиваются.

Отправка файла и голосового: BFF `POST /chat-attachments/{chatId}` → `POST conversations/{id}/messages/` (multipart: `file`, `caption`, `voice`). Передача чата директором или РОПом: `POST conversations/{id}/transfer/`.
