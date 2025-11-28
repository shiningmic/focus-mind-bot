# 🧠 Focus Mind Bot

**Focus Mind** is a Telegram bot for daily, weekly, and monthly
self-reflection, productivity tracking, and emotional awareness.

The goal of this project is to create a personal mental and productivity
companion that helps users: - stay focused during the day, - reflect on
their progress, - track emotions, - and later analyze patterns using AI.

This project is currently in **active development** and is not yet
considered a stable release.

---

## 🎯 Project Goals

Focus Mind is designed to help users:

- Build daily reflection habits
- Track goals and time focus
- Become more aware of emotional state
- Review weekly and monthly progress
- Analyze productivity patterns (later with AI)

It is meant to be: - simple to use, - fully customizable, - available
for free for everyone.

---

## ✅ Current State

At the moment, the project includes:

- ✅ Node.js + TypeScript setup
- ✅ Telegram bot powered by Telegraf
- ✅ MongoDB connection via Mongoose
- ✅ Environment variables validation
- ✅ Project structure ready for scaling

No user logic, sessions, or scheduling is implemented yet.

---

## 🚀 Planned Features (MVP)

The first MVP version will include:

- Daily reflection sessions (morning / day / evening)
- Weekly reflection blocks
- Monthly reflection blocks
- Custom sets of questions per slot
- Flexible scheduling with fixed or random time inside slots
- User timezone support
- Answer storage in MongoDB
- History of reflections
- Basic statistics and summaries

Later versions will include:

- AI-based analysis of user answers
- Emotional tracking
- Personalized insights
- Smart reminders and behavioral patterns

---

## ⚙️ Technology Stack

- **TypeScript**
- **Node.js**
- **Telegraf (Telegram Bot API)**
- **MongoDB + Mongoose**
- **node-cron**
- **dotenv**

---

## 📦 Installation

Clone the repository:

```bash
git clone https://github.com/shiningmic/focus-mind-bot.git
cd focus-mind-bot
```

Install dependencies:

```bash
npm install
```

Create `.env` file:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
MONGODB_URI=your_mongodb_connection_string
NODE_ENV=development
```

Run in development mode:

```bash
npm run dev
```

---

## 🛠 Development Status

This project is developed by a **solo developer** and is currently in an
early experimental stage.

Expect: - breaking changes, - frequent refactoring, - unstable APIs
during the MVP phase.

---

## 📌 Roadmap

- [ ] User model and database schemas
- [ ] Slot configuration system
- [ ] Question blocks
- [ ] Session execution engine
- [ ] Daily scheduling
- [ ] Weekly scheduling
- [ ] Monthly scheduling
- [ ] Answer storage
- [ ] Reflection history
- [ ] AI analysis layer

---

## 📄 License

This project is currently under the **ISC license**.

---

## 👤 Author

Developed by **shiningmic**.

---

🧠 _Focus Mind is not about doing more.\
It's about understanding how you think, feel, and grow._
