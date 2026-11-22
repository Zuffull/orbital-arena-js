import { readFile, writeFile } from "node:fs/promises";

const read = async path => JSON.parse(await readFile(path, "utf8"));
const [before, after, load, coverage] = await Promise.all([
  read("docs/lab-07-before.json"), read("docs/lab-07-after.json"),
  read("docs/lab-07-load.json"), read("coverage/coverage-summary.json"),
]);
const ms = n => n.toFixed(3);
const trio = values => values.map(ms).join(" / ");
const first = load.find(row => row.max > 33);
const max = Math.max(34, ...load.map(row => row.max));
const x = i => 90 + i * 175;
const y = n => 260 - 202 * n / max;
const points = field => load.map((r, i) => `${x(i)},${y(r[field])}`).join(" ");
const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="325" viewBox="0 0 700 325" font-family="system-ui">
<rect width="700" height="325" rx="8" fill="#172237"/>
<text x="30" y="32" fill="white" font-size="18">Server tick under WebSocket load (ms)</text>
<path d="M75 53V260H642" fill="none" stroke="#b1bdd0"/>
<path d="M75 ${y(33)}H642" stroke="#f6a97e" stroke-dasharray="5 5"/>
<text x="80" y="${y(33) - 5}" fill="#f6a97e" font-size="12">33 ms</text>
<polyline points="${points("p99")}" fill="none" stroke="#75defa" stroke-width="3"/><polyline points="${points("max")}" fill="none" stroke="#ffee90" stroke-width="3"/>
${load.map((row, i) => `<text x="${x(i)}" y="280" fill="white" text-anchor="middle">${row.clients}</text><circle cx="${x(i)}" cy="${y(row.max)}" r="4" fill="#ffee90"/><circle cx="${x(i)}" cy="${y(row.p99)}" r="4" fill="#75defa"/>`).join("")}
<text x="85" y="307" fill="#75defa">p99 tick</text><text x="185" y="307" fill="#ffee90">max tick</text><text x="530" y="307" fill="white">Clients</text></svg>`;
await writeFile("docs/lab-07-load.svg", chart);
const source = row => row.allocations.map(([name, bytes]) =>
  `${name.replace(/[|<>]/g, "")} (${(bytes / 1024).toFixed(1)} KiB)`).slice(0, 3).join(", ") || "немає вибірок";
const report = `
### Вимірювання

30 с на збірку. Chromium ${after.chromium} у headless на одному runner Ubuntu. Сім клієнтів надсилали двійкові пакети input, восьмий керувався через клавіатуру в браузері. Профайлер Chrome записав стек CPU, вибірки алокацій і паузи GC на потоці рендерера. Вибірки алокацій наведено в KiB, вони оцінюють обсяг виділеної пам’яті, а не кількість об’єктів.

| Збірка | Кадрів | Інтервал rAF p50 / p95 / p99, мс | Callback рендерера p50 / p95 / p99, мс | GC, кількість | GC, сума / максимум, мс |
| --- | ---: | ---: | ---: | ---: | ---: |
| До, lab-06 | ${before.frames} | ${trio(before.frameMs)} | ${trio(before.callbackMs)} | ${before.gc.count} | ${ms(before.gc.total)} / ${ms(before.gc.max)} |
| Після, lab-07 | ${after.frames} | ${trio(after.frameMs)} | ${trio(after.callbackMs)} | ${after.gc.count} | ${ms(after.gc.total)} / ${ms(after.gc.max)} |

p99 роботи callback ${after.callbackMs[2] < 16.7 ? "вклався" : "не вклався"} у 16,7 мс. p99 інтервалу між кадрами ${after.frameMs[2] < 16.7 ? "вклався" : "не вклався"} у 16,7 мс. Інтервал rAF включає очікування наступного кадру, планування ОС та витрати профайлера. Найдовша зафіксована пауза GC після змін склала **${ms(after.gc.max)} мс**.

Найбільші вибірки алокацій з клієнтського bundle до змін — ${source(before)}. Після змін — ${source(after)}. Серверна симуляція перевикористовує кулі й набори частинок, координати оновлюються на місці. Зберегли хеш детермінізму з lab-06.

![До. Стек викликів, записаний Chrome DevTools CPU Profiler](docs/lab-07-before.png)

![Після. Стек викликів, записаний Chrome DevTools CPU Profiler](docs/lab-07-after.png)

### Web Worker

Винесли сортування і підрахунок перцентилів профілю в експериментальний Worker. У 20 парних спробах медіана розрахунку на головному потоці склала ${ms(after.worker.local)} мс, відправлення з transferable buffer — ${ms(after.worker.dispatch)} мс, повний обмін із Worker — ${ms(after.worker.roundTrip)} мс. Ця операція виконується після запису, тому Worker залишається лише у відтворюваному профільному експерименті. Ігровий потік і кадри не залежать від обміну повідомленнями з Worker.

### Навантаження сервера

Клієнти заходять групами по вісім, як у звичайній грі. Для кожного рівня навантаження даємо всім кімнатам працювати 8,5 с. У таблиці беремо найвище значення кожної метрики серед кімнат.

| Клієнти | Кімнати | p99 кроку, мс | Максимум кроку, мс | Найбільший середній час фізики, мс | Найбільший середній час кроку, мс |
| ---: | ---: | ---: | ---: | ---: | ---: |
${load.map(row => `| ${row.clients} | ${row.rooms} | ${ms(row.p99)} | ${ms(row.max)} | ${ms(row.meanPhysics)} | ${ms(row.meanTick)} |`).join("\n")}

${first ? `Перший рівень, на якому окремий крок перевищив 33 мс — ${first.clients} клієнтів.` : "У цьому прогоні крок не перевищив 33 мс до 128 клієнтів включно."} Колізії залишили попарними. У навантаженні вимірювали весь крок фізики, включно з колізіями, та повний крок із пакуванням і розсилкою знімків.

![Графік часу кроку при 8, 32, 64 та 128 клієнтах](docs/lab-07-load.svg)

Покриття shared/ за рядками становить **${coverage.total.lines.pct} %**, за інструкціями — **${coverage.total.statements.pct} %**, за функціями — **${coverage.total.functions.pct} %**. Вихідні JSON і профілі лежать у docs/.
`;
const path = "README.md";
const readme = (await readFile(path, "utf8")).split("<!-- lab07-measurements -->")[0].trimEnd();
await writeFile(path, readme + "\n\n<!-- lab07-measurements -->\n" + report);
