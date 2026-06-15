# Building Height Data Analyzer

Интерактивный браузерный прототип для анализа этажности и высоты зданий на карте. Проект ориентирован на задачи градостроительного анализа Ленинградской области и Санкт-Петербурга.

[![HTML](https://img.shields.io/badge/HTML5-prototype-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![OpenStreetMap](https://img.shields.io/badge/data-OpenStreetMap-7EBC6F?logo=openstreetmap&logoColor=white)](https://www.openstreetmap.org/)

## Возможности

- визуализация зданий и их контуров на интерактивной карте;
- загрузка пользовательских данных из CSV;
- получение этажности и высоты из OpenStreetMap через Overpass API;
- подключение GeoJSON и ArcGIS FeatureServer/MapServer;
- фильтрация по адресу, названию, кадастровому номеру, типу и этажности;
- статистика по зданиям в видимой области;
- переключение между этажами и высотой в метрах;
- светлая и тёмная темы;
- адаптивный интерфейс для настольных и мобильных устройств;
- управление детализацией в зависимости от масштаба карты.

## Быстрый запуск

Проект не требует сборки или установки зависимостей.

1. Откройте файл [`версия 2/preview/index.html`](версия%202/preview/index.html) в современном браузере.
2. Разрешите сетевые запросы к внешним картографическим сервисам.
3. Перемещайте и масштабируйте карту либо загрузите собственный CSV-файл.

Для корректной работы браузерных запросов рекомендуется запуск через локальный HTTP-сервер:

```bash
python -m http.server 8000
```

После запуска откройте:

```text
http://localhost:8000/версия%202/preview/
```

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
|   |   `-- index.html          # актуальная расширенная версия
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

Сейчас это автономный HTML-прототип. Основной рабочий вариант находится в каталоге [`версия 2`](версия%202). План дальнейшего развития включает перенос интерфейса на Next.js и TypeScript, усиление валидации данных, объединение источников и автоматизированное тестирование.

Подробный план: [`implementation-plan.md`](implementation-plan.md).

## Лицензирование данных

При использовании OpenStreetMap необходимо соблюдать условия [Open Database License](https://www.openstreetmap.org/copyright) и указывать авторство участников OpenStreetMap.
