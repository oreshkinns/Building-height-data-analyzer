# Building Height Data Analyzer

Интерактивный браузерный прототип для анализа этажности и высоты зданий на карте. Проект ориентирован на задачи градостроительного анализа Ленинградской области и Санкт-Петербурга.

[![HTML](https://img.shields.io/badge/HTML5-prototype-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![OpenStreetMap](https://img.shields.io/badge/data-OpenStreetMap-7EBC6F?logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)

## Возможности

- визуализация зданий и их контуров на интерактивной карте;
- загрузка пользовательских данных из CSV;
- получение этажности и высоты из OpenStreetMap через Overpass API;
- автоматическое получение контуров и высот Яндекса и 2ГИС через backend ArchTools; этажность из метров не выводится, источники и расхождения показаны отдельно;
- подключение GeoJSON и ArcGIS FeatureServer/MapServer;
- фильтрация по адресу, названию, кадастровому номеру, типу и этажности;
- статистика по зданиям в видимой области;
- переключение между этажами и высотой в метрах;
- светлая и тёмная темы;
- адаптивный интерфейс для настольных и мобильных устройств;
- управление детализацией в зависимости от масштаба карты.

## Быстрый запуск

Проект не требует сборки или установки зависимостей.

Запустите локальный HTTP-сервер из корня проекта (прямой запуск через `file://` блокируется API НСПД):

```bash
python -m http.server 8000
```

Откройте в современном браузере:

```text
http://localhost:8000/версия%203/preview/
```

Версия 4 вместо прямых запросов к НСПД из браузера использует backend-proxy на [pynspd](https://github.com/yazmolod/pynspd) — см. [`версия 4/implementation-plan.md`](версия%204/implementation-plan.md). Запускается отдельно:

```bash
cd "версия 4/server"
pip install -r requirements.txt
python -m uvicorn main:app --port 8000
```

и открывается на `http://localhost:8000/`.

Разрешите сетевые запросы к внешним картографическим сервисам, затем перемещайте и масштабируйте карту либо загрузите собственный CSV-файл.

Яндекс и 2ГИС доступны при запуске внутри ArchTools с его защищённым API `/api/building-height-analyzer/`. Самостоятельный статический HTTP-сервер поддерживает OSM/CSV, но не заменяет этот backend. В режиме метров подписи округляются для чтения; исходные значения сохраняются. Неизвестная этажность не означает отсутствие высоты.

## Формат CSV

Обязательные поля:

| Поле | Описание |
| --- | --- |
| `name` | Название объекта |
| `lat` | Широта |
| `lng` | Долгота |
| `floors` | Количество этажей |

Дополнительно поддерживаются `address`, `building_type`, `year_built`, `height_meters`, `cadastral_number` и `source`.

Пример:

```csv
name,lat,lng,floors,address,building_type,year_built
Дом 1,59.9386,30.3141,7,Санкт-Петербург,residential,1985
```

## Структура

```text
.
|-- preview/
|   `-- index.html              # первая версия прототипа
|-- версия 2/
|   |-- preview/
|   |   `-- index.html          # расширенная версия (OSM, РГИС, НСПД)
|   `-- implementation-plan.md
|-- версия 3/
|   |-- preview/
|   |   `-- index.html          # OSM + локальная типология соседних зданий, без НСПД
|   `-- implementation-plan.md
|-- версия 4/
|   |-- preview/
|   |   `-- index.html          # та же версия 3, но НСПД-запросы идут через backend-proxy
|   |-- server/
|   |   |-- main.py             # FastAPI + pynspd, отдаёт и API, и статику
|   |   |-- requirements.txt
|   |   `-- start_server.bat
|   `-- implementation-plan.md
|-- implementation-plan.md
`-- README.md
```

## Источники данных

- OpenStreetMap и Overpass API;
- пользовательские CSV-файлы;
- прямые GeoJSON-слои;
- ArcGIS FeatureServer/MapServer;
- региональные и муниципальные геоинформационные системы при наличии открытых конечных точек.

Доступность внешних источников зависит от CORS, лимитов API и состояния сторонних серверов. Полученные данные следует проверять перед использованием в официальной аналитике.

## Статус проекта

Сейчас это автономный HTML-прототип. Основной рабочий вариант находится в каталоге [`версия 4`](версия%204) (та же версия 3, но НСПД-запросы идут через backend-proxy на pynspd, а не напрямую из браузера). План дальнейшего развития включает перенос интерфейса на Next.js и TypeScript, усиление валидации данных, объединение источников и автоматизированное тестирование.

Подробный план: [`implementation-plan.md`](implementation-plan.md).

## Лицензирование данных

При использовании OpenStreetMap необходимо соблюдать условия [Open Database License](https://www.openstreetmap.org/copyright) и указывать авторство участников OpenStreetMap.
