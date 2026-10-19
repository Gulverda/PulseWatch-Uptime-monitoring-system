# PulseWatch — Uptime Monitoring System

## პროექტის აღწერა

PulseWatch არის სისტემა, რომელიც ვებსაიტებსა და API-ებს პერიოდულად ამოწმებს და აფიქსირებს, როდის ჩავარდა სერვისი და რამდენ ხანს არ მუშაობდა. ის განკუთვნილია დეველოპერებისთვის, მცირე გუნდებისა და სტარტაპებისთვის, რომლებსაც სერვისის გათიშვის შესახებ კლიენტამდე უნდა გაიგონ. სისტემა ყოველ 30/60/300 წამში ამოწმებს მითითებულ URL-ს, ინახავს response time-სა და სტატუსს, ითვლის uptime-ის პროცენტს, ჩავარდნისას აგზავნის ალერტს და საჯარო status page-ზე აჩვენებს სერვისის მიმდინარე მდგომარეობას.

**სტეკი:** Node.js, TypeScript, Fastify, BullMQ + Redis, PostgreSQL + Prisma, Docker Compose. Frontend დაიგეგმება React + Vite-ზე.

---

## Stakeholder-ები

| როლი | ტიპი | რა აინტერესებს |
|---|---|---|
| **Owner / დეველოპერი** | იყენებს | მონიტორების მარტივად დამატება და იმის გაგება, როდის და რატომ ჩავარდა მისი სერვისი. |
| **გუნდის წევრი / On-call ინჟინერი** | იყენებს | ჩავარდნის შესახებ ალერტის დროულად მიღება, რომ პრობლემა სწრაფად მოაგვაროს. |
| **Status page-ის ვიზიტორი (კლიენტი)** | იყენებს | ავტორიზაციის გარეშე ნახოს, მუშაობს თუ არა სერვისი ახლა და იყო თუ არა ბოლო დროს ინციდენტი. |
| **პლატფორმის ადმინისტრატორი** | იხდის / ვეტო | ინფრასტრუქტურის ხარჯი, ლიმიტები და ბოროტად გამოყენების (SSRF, spam) პრევენცია. აქვს ვეტოს უფლება ნებისმიერ ფუნქციაზე, რომელიც უსაფრთხოებას ან ხარჯს საფრთხეს უქმნის. |

---

## User Stories

ფორმატი: **As a** [როლი], **I want** [ფუნქცია], **so that** [სარგებელი].
Acceptance criteria იწერება **Given / When / Then** ფორმატით.
შეფასება Fibonacci-ის სკალით: 1, 2, 3, 5, 8, 13.

### ✅ უკვე რეალიზებული (Done)

#### US-01 · მონიტორის დამატება
**Must · 3 ქულა · Done**
As an **Owner**, I want to add a URL with a check interval, so that the system starts monitoring my service.
- **Given** მომხმარებელი აგზავნის ვალიდურ HTTP/HTTPS URL-ს და ინტერვალს (30, 60 ან 300 წმ), **When** ის იძახებს `POST /monitors`, **Then** მონიტორი იქმნება, პირველი შემოწმება მაშინვე დგება რიგში და API აბრუნებს `202`-ს.
- **Given** ინტერვალი არ არის მითითებული, **When** მონიტორი იქმნება, **Then** ინტერვალი default-ად 60 წამია.
- **Given** URL არავალიდურია ან ინტერვალი დაშვებულ სიაში არ არის, **When** მოთხოვნა იგზავნება, **Then** API აბრუნებს `400`-ს გასაგები შეტყობინებით.

#### US-02 · პერიოდული შემოწმება worker-ით
**Must · 5 ქულა · Done**
As an **Owner**, I want my URL to be checked automatically on schedule, so that I don't have to check it manually.
- **Given** აქტიური მონიტორი 60 წმ ინტერვალით, **When** ინტერვალი გავა, **Then** worker აგზავნის GET მოთხოვნას და ინახავს `isUp`-ს, `statusCode`-ს და `responseTimeMs`-ს.
- **Given** სერვისი 5 წამში არ პასუხობს, **When** შემოწმება სრულდება, **Then** შედეგი ინახება როგორც `isUp = false` შეცდომის ტექსტით.
- **Given** სერვერი გადაიტვირთა, **When** API ჩაირთვება, **Then** ყველა აქტიური მონიტორი თავიდან იგეგმება.

#### US-03 · SSRF დაცვა
**Must · 3 ქულა · Done**
As a **Platform Admin**, I want the system to block private and internal addresses, so that no one can use PulseWatch to attack our internal network.
- **Given** URL მიუთითებს `localhost`-ზე, `.local`/`.internal` დომენზე ან private IP-ზე, **When** მონიტორის დამატება ხდება, **Then** API აბრუნებს `400`-ს.
- **Given** საჯარო URL redirect-ს აკეთებს private მისამართზე, **When** worker შემოწმებას ასრულებს, **Then** redirect იბლოკება და შემოწმება `isUp = false` შედეგით ინახება.
- **Given** redirect-ების ჯაჭვი 5-ზე მეტია, **When** worker შემოწმებას ასრულებს, **Then** შემოწმება წყდება შეცდომით "Maximum redirect limit exceeded".

#### US-04 · მონიტორის პაუზა, აღდგენა და წაშლა
**Must · 2 ქულა · Done**
As an **Owner**, I want to pause, resume or delete a monitor, so that I control what is being checked.
- **Given** აქტიური მონიტორი, **When** მომხმარებელი იძახებს `PATCH /monitors/:id/pause`, **Then** მონიტორი ხდება არააქტიური და მისი შემოწმება ჩერდება.
- **Given** დაპაუზებული მონიტორი, **When** მომხმარებელი იძახებს `PATCH /monitors/:id/resume`, **Then** შემოწმება მაშინვე დგება რიგში და განრიგი აღდგება.
- **Given** მონიტორი არსებობს, **When** მომხმარებელი იძახებს `DELETE /monitors/:id`, **Then** იშლება მონიტორი და მისი ყველა შემოწმება.

#### US-05 · შემოწმებების ისტორია
**Must · 2 ქულა · Done**
As an **Owner**, I want to see the history of checks, so that I can investigate when problems happened.
- **Given** მონიტორს აქვს შემოწმებები, **When** მომხმარებელი იძახებს `GET /monitors/:id/checks`, **Then** ბრუნდება შემოწმებები უახლესიდან უძველესისკენ, default-ად 20 ცალი.
- **Given** `limit` 100-ზე მეტია, **When** მოთხოვნა იგზავნება, **Then** API აბრუნებს `400`-ს.
- **Given** შემოწმებები ერთ გვერდზე არ ეტევა, **When** პასუხი ბრუნდება, **Then** მასში არის `pagination.total` და `hasMore`.

#### US-06 · Uptime სტატისტიკა
**Must · 3 ქულა · Done**
As an **Owner**, I want to see uptime percentage and average response time, so that I can measure reliability of my service.
- **Given** მონიტორს აქვს შემოწმებები ბოლო 7 დღეში, **When** მომხმარებელი იძახებს `GET /monitors/:id/stats`, **Then** ბრუნდება `uptimePercentage` და `averageResponseTimeMs` ორი ფანჯრისთვის: 24 საათი და 7 დღე.
- **Given** ფანჯარაში შემოწმება არ არის, **When** სტატისტიკა ითვლება, **Then** მნიშვნელობა არის `null` და არა `0` ან `NaN`.

---

### 🔲 დასაგეგმი (Backlog)

#### BUG-01 · Resume ინტერვალს 60 წამზე აბრუნებს
**Must · 1 ქულა**
As an **Owner**, I want my chosen interval to stay the same after resuming a monitor, so that my settings are not lost.
- **Given** მონიტორს აქვს 300 წმ ინტერვალი და დაპაუზებულია, **When** მომხმარებელი მას resume-ს უკეთებს, **Then** განრიგი ისევ 300 წამიანია და არა 60.

> მიზეზი: `/monitors/:id/resume` იძახებს `scheduleMonitor(monitor.id, monitor.url)`-ს `intervalSeconds`-ის გარეშე.

#### US-07 · რეგისტრაცია და ავტორიზაცია
**Must · 5 ქულა**
As an **Owner**, I want to register and log in, so that my monitors are private to me.
- **Given** ახალი მომხმარებელი, **When** ის აგზავნის ელ-ფოსტას და პაროლს (მინიმუმ 8 სიმბოლო), **Then** იქმნება ანგარიში და პაროლი ინახება bcrypt hash-ით.
- **Given** რეგისტრირებული მომხმარებელი, **When** ის სწორ მონაცემებს შეიყვანს, **Then** იღებს JWT ტოკენს, რომლის ვადაა 7 დღე.
- **Given** მოთხოვნას ტოკენი არ აქვს ან ტოკენი არავალიდურია, **When** ის მიმართავს `/monitors`-ის ნებისმიერ endpoint-ს, **Then** API აბრუნებს `401`-ს.

#### US-08 · მონიტორები მომხმარებელზე მიბმული
**Must · 3 ქულა**
As an **Owner**, I want to see only my own monitors, so that other users can't see or change them.
- **Given** მომხმარებელი A და მომხმარებელი B, **When** A იძახებს `GET /monitors`, **Then** ბრუნდება მხოლოდ A-ს მონიტორები.
- **Given** მონიტორი ეკუთვნის B-ს, **When** A ცდილობს მის წაშლას ან შეცვლას, **Then** API აბრუნებს `404`-ს.

#### US-09 · ინციდენტის ავტომატური გახსნა და დახურვა
**Must · 5 ქულა**
As an **On-call engineer**, I want an incident to be opened after repeated failures, so that one random timeout doesn't create false alarms.
- **Given** მონიტორი მუშაობს, **When** ზედიზედ 3 შემოწმება ჩავარდება, **Then** იქმნება ინციდენტი სტატუსით `OPEN` და დაწყების დროით.
- **Given** ინციდენტი ღიაა, **When** შემდეგი შემოწმება წარმატებულია, **Then** ინციდენტი იხურება და ინახება მისი ხანგრძლივობა.
- **Given** ინციდენტი უკვე ღიაა, **When** შემოწმებები ისევ ვარდება, **Then** ახალი ინციდენტი არ იქმნება.

#### US-10 · Email ალერტი
**Must · 3 ქულა**
As an **On-call engineer**, I want to get an email when my service goes down and comes back up, so that I know immediately without watching the dashboard.
- **Given** იხსნება ინციდენტი, **When** სისტემა მას აფიქსირებს, **Then** მონიტორის მფლობელს ეგზავნება email URL-ით, შეცდომით და დროით.
- **Given** ინციდენტი იხურება, **When** სერვისი აღდგება, **Then** იგზავნება email "Service recovered" ინციდენტის ხანგრძლივობით.
- **Given** email-ის გაგზავნა ვერ მოხერხდა, **When** worker ცდილობს გაგზავნას, **Then** ცდა მეორდება მაქსიმუმ 3-ჯერ და შეცდომა ილოგება.

#### US-11 · Dashboard: მონიტორების სია
**Must · 3 ქულა**
*(დაშლილია ორიგინალური 13-ქულიანი "Dashboard UI" story-დან, US-11, US-12 და US-13-ად)*
As an **Owner**, I want to see all my monitors with their current status, so that I see the state of everything at a glance.
- **Given** მომხმარებელი შესულია, **When** ის ხსნის dashboard-ს, **Then** ხედავს მონიტორების სიას: URL, სტატუსი (UP / DOWN / PAUSED), ბოლო response time და 24 საათის uptime %.
- **Given** მონიტორი DOWN-ია, **When** სია იხატება, **Then** სტატუსი წითლად არის მონიშნული და სიის თავშია.
- **Given** მომხმარებელს მონიტორი არ აქვს, **When** ის ხსნის dashboard-ს, **Then** ხედავს ცარიელ მდგომარეობას ღილაკით "დაამატე პირველი მონიტორი".

#### US-12 · Dashboard: მონიტორის დამატების ფორმა
**Must · 2 ქულა**
As an **Owner**, I want a form to add a monitor, so that I don't have to call the API by hand.
- **Given** მომხმარებელი ხსნის ფორმას, **When** ის შეიყვანს URL-ს და ირჩევს ინტერვალს, **Then** მონიტორი ჩნდება სიაში გვერდის გადატვირთვის გარეშე.
- **Given** API აბრუნებს `400`-ს, **When** ფორმა იგზავნება, **Then** შეცდომის ტექსტი ჩანს ველის ქვეშ.

#### US-13 · მონიტორის დეტალური გვერდი გრაფიკით
**Should · 5 ქულა**
As an **Owner**, I want a page with a response time chart and incident list, so that I can analyze performance over time.
- **Given** მომხმარებელი ხსნის მონიტორის გვერდს, **When** გვერდი იტვირთება, **Then** ჩანს response time-ის გრაფიკი ბოლო 24 საათისთვის და uptime 24 სთ / 7 დღისთვის.
- **Given** მონიტორს ჰქონდა ინციდენტები, **When** გვერდი იტვირთება, **Then** ჩანს ინციდენტების სია დაწყების დროით და ხანგრძლივობით.

#### US-14 · საჯარო Status Page
**Should · 5 ქულა**
As a **Status page visitor**, I want to open a public page without logging in, so that I can see if the service is working right now.
- **Given** Owner-მა მონიტორი საჯაროდ მონიშნა, **When** ვიზიტორი ხსნის `/status/:slug`-ს, **Then** ხედავს სერვისის სახელს, მიმდინარე სტატუსს და 90 დღის uptime-ის ზოლს.
- **Given** მონიტორი საჯარო არ არის, **When** ვიზიტორი ცდილობს გვერდის გახსნას, **Then** ბრუნდება `404`.
- **Given** მიმდინარეობს ინციდენტი, **When** ვიზიტორი ხსნის გვერდს, **Then** გვერდის თავში ჩანს გაფრთხილება.

#### US-15 · Telegram ალერტი
**Should · 3 ქულა**
As an **On-call engineer**, I want alerts in Telegram, so that I see them on my phone faster than email.
- **Given** მომხმარებელმა Telegram chat დააკავშირა, **When** იხსნება ან იხურება ინციდენტი, **Then** შეტყობინება მოდის Telegram-ში.
- **Given** Telegram არ არის დაკავშირებული, **When** ინციდენტი იხსნება, **Then** იგზავნება მხოლოდ email.

#### US-16 · მომხმარებლის ლიმიტები (ადმინი)
**Should · 3 ქულა**
As a **Platform Admin**, I want to limit how many monitors a user can create, so that infrastructure costs stay under control.
- **Given** მომხმარებელს უკვე აქვს 10 მონიტორი (free ლიმიტი), **When** ის ცდილობს მე-11-ის დამატებას, **Then** API აბრუნებს `403`-ს შეტყობინებით ლიმიტის შესახებ.
- **Given** ადმინი ცვლის მომხმარებლის ლიმიტს, **When** ცვლილება ინახება, **Then** ახალი ლიმიტი მაშინვე მოქმედებს.

#### US-17 · გუნდის მოწვევა
**Could · 8 ქულა**
As an **Owner**, I want to invite teammates to my workspace, so that they can see monitors and receive alerts too.
- **Given** Owner აგზავნის მოწვევას ელ-ფოსტაზე, **When** მოწვეული მომხმარებელი მას იღებს, **Then** ის ხედავს workspace-ის ყველა მონიტორს.
- **Given** გუნდის წევრს აქვს როლი `viewer`, **When** ის ცდილობს მონიტორის წაშლას, **Then** API აბრუნებს `403`-ს.

#### US-18 · Maintenance Window
**Could · 3 ქულა**
As an **Owner**, I want to schedule maintenance time, so that planned downtime doesn't create incidents and alerts.
- **Given** მონიტორზე დაგეგმილია maintenance 02:00–03:00, **When** ამ პერიოდში შემოწმება ვარდება, **Then** ინციდენტი და ალერტი არ იქმნება.
- **Given** maintenance მიმდინარეობს, **When** ვიზიტორი ხსნის status page-ს, **Then** ხედავს სტატუსს "Maintenance".

#### US-19 · SSL სერტიფიკატის ვადის შემოწმება
**Could · 3 ქულა**
As an **Owner**, I want a warning before my SSL certificate expires, so that my site doesn't break because of an expired certificate.
- **Given** HTTPS მონიტორის სერტიფიკატის ვადა 14 დღეზე ნაკლებში იწურება, **When** ხდება დღიური შემოწმება, **Then** Owner-ს ეგზავნება გაფრთხილება.

#### US-20 · ბილინგი და ფასიანი გეგმები
**Won't have (this time)**
As a **Platform Admin**, I want paid plans with higher limits, so that the platform covers its costs.
> ამ სემესტრში არ კეთდება: MVP-ს ღირებულება მის გარეშეც მოწმდება, გადახდის ინტეგრაცია კი სკოუპს გაზრდიდა.

---

## არაფუნქციური მოთხოვნები

| ID | მოთხოვნა | როგორ მოწმდება |
|---|---|---|
| **NFR-01** | ალერტი იგზავნება სერვისის ჩავარდნიდან **≤ 90 წამში** (60 წმ ინტერვალის დროს). | ტესტური სერვერის გათიშვა და დროის გაზომვა. |
| **NFR-02** | ერთი შემოწმების timeout არის **5 წამი**. ამაზე ნელი პასუხი ითვლება DOWN-ად. | Unit ტესტი ნელი mock სერვერით. |
| **NFR-03** | API ზღუდავს **100 მოთხოვნამდე წუთში** თითო კლიენტზე. ზედმეტ მოთხოვნაზე ბრუნდება `429`. | Load ტესტი (autocannon / k6). |
| **NFR-04** | სისტემა ამუშავებს **500 აქტიურ მონიტორს** 60 წმ ინტერვალით, ხოლო რიგის დაყოვნება **≤ 5 წამია**. | k6 / BullMQ metrics. |
| **NFR-05** | Dashboard იტვირთება **≤ 2 წამში** (p95), ხოლო API-ის პასუხის დრო **≤ 300 ms**-ია (p95). | Lighthouse და API load ტესტი. |
| **NFR-06** | შემოწმების შედეგი არ იკარგება: worker-ის ჩავარდნისას job მეორდება **3-ჯერ** exponential backoff-ით. | Worker-ის იძულებითი გათიშვის ტესტი. |

---

## MoSCoW და შეფასება: შეჯამება

| ID | Story | MoSCoW | ქულა | სტატუსი |
|---|---|---|---|---|
| US-01 | მონიტორის დამატება | Must | 3 | Done |
| US-02 | პერიოდული შემოწმება | Must | 5 | Done |
| US-03 | SSRF დაცვა | Must | 3 | Done |
| US-04 | პაუზა / აღდგენა / წაშლა | Must | 2 | Done |
| US-05 | შემოწმებების ისტორია | Must | 2 | Done |
| US-06 | Uptime სტატისტიკა | Must | 3 | Done |
| BUG-01 | Resume ინტერვალის bug | Must | 1 | Done |
| US-07 | რეგისტრაცია / ავტორიზაცია | Must | 5 | Backlog |
| US-08 | მონიტორების ownership | Must | 3 | Backlog |
| US-09 | ინციდენტები | Must | 5 | Backlog |
| US-10 | Email ალერტი | Must | 3 | Backlog |
| US-11 | Dashboard: სია | Must | 3 | Backlog |
| US-12 | Dashboard: ფორმა | Must | 2 | Backlog |
| US-13 | დეტალური გვერდი + გრაფიკი | Should | 5 | Backlog |
| US-14 | საჯარო Status Page | Should | 5 | Backlog |
| US-15 | Telegram ალერტი | Should | 3 | Backlog |
| US-16 | მომხმარებლის ლიმიტები | Should | 3 | Backlog |
| US-17 | გუნდის მოწვევა | Could | 8 | Backlog |
| US-18 | Maintenance window | Could | 3 | Backlog |
| US-19 | SSL ვადის შემოწმება | Could | 3 | Backlog |
| US-20 | ბილინგი | Won't | – | – |

**ჯამი კატეგორიების მიხედვით:**
- **Must:** 40 ქულა (19 ქულა უკვე შესრულებულია, 21 დარჩენილია)
- **Should:** 16 ქულა
- **Could:** 14 ქულა
- **Won't:** 1 story

---

## MVP სკოუპი

MVP შედგება ყველა **Must have** story-სგან: **US-01 – US-12 და BUG-01, ჯამში 40 ქულა.**

MVP-ის დასრულების შემდეგ მომხმარებელს შეეძლება:
1. დარეგისტრირდეს და დაამატოს საკუთარი მონიტორები dashboard-იდან.
2. ნახოს თითოეული სერვისის მიმდინარე სტატუსი, ისტორია და uptime %.
3. მიიღოს email ალერტი, როცა სერვისი ჩავარდება და როცა აღდგება.

ყველაფერი, რაც ამ სამ შესაძლებლობას არ ემსახურება (status page, Telegram, გუნდები), MVP-ის შემდეგ კეთდება Should/Could პრიორიტეტით.

---

## Definition of Done

Story დასრულებულად ითვლება, როცა შესრულებულია **ყველა** პირობა:

- [ ] ყველა acceptance criteria შესრულებულია და ხელით შემოწმებულია.
- [ ] კოდი დამერჯილია `main`-ში Pull Request-ის გავლით.
- [ ] ახალ ლოგიკას აქვს Vitest unit/integration ტესტები, ხოლო `npm test` გადის შეცდომების გარეშე.
- [ ] `tsc --noEmit` გადის TypeScript შეცდომების გარეშე.
- [ ] DB სქემის ცვლილებას თან ახლავს Prisma migration.
- [ ] ახალი endpoint-ი ან ცვლილება აღწერილია README-ის API სექციაში.
- [ ] კოდში არ არის hardcoded საიდუმლოებები. ყველაფერი `.env`-შია, `.env.example` კი განახლებულია.
- [ ] GitHub Projects დაფაზე ბარათი გადატანილია **Done** სვეტში.

---

## GitHub Projects დაფა

**სვეტები:** `Backlog` → `Ready` → `In Progress` → `In Review` → `Done`

**Custom ველები:**
- `Priority`: Must / Should / Could / Won't
- `Estimate`: 1, 2, 3, 5, 8, 13

**Label-ები:** `story`, `bug`, `backend`, `frontend`, `nfr`

თითოეული story იქმნება ცალკე GitHub Issue-ად. Issue-ს სათაურია ID და სახელი (მაგ. `US-09 · ინციდენტის ავტომატური გახსნა და დახურვა`), ხოლო body-ში ჩაწერილია user story და acceptance criteria.

---

## გაშვება

```bash
docker compose up -d      # PostgreSQL + Redis
npm install
npx prisma migrate dev
npm run dev               # API → http://127.0.0.1:3000
npm run worker            # შემოწმებების worker
```
