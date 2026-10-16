# 📚 **DATABASE ARCHITECTURE & SCHEMA SPECIFICATION**

> **Project:** VocabAI & Grammar Quest System  
> **Database Engine:** `PostgreSQL` (Hosted via Supabase)  
> **Status:** `PRODUCTION-READY`  
> **Target Audience:** *AI Assistants, Developers, & System Architects*

---

## 🧭 **1. SYSTEM ARCHITECTURE OVERVIEW**

This database is built with modern EdTech standards, ensuring high scalability and data integrity:
* 🔑 **Relational Integrity:** Strict **Foreign Keys** with `ON DELETE CASCADE` rules to prevent orphaned records.
* 📦 **Polymorphic JSONB:** Leverages `JSONB` for flexible structures (slide decks, game payloads, word families) without altering core SQL schemas.
* ⚡ **Performance Optimization:** Fully indexed foreign keys and automated timestamps managed via **PostgreSQL Triggers**.

---

## 👥 **2. AUTHENTICATION & USER MANAGEMENT**

### 👤 `public.users`
*Stores user profile details, experience points (XP), daily streaks, and cached statistics.*

* **Columns:**
  * `id` (`uuid`, **PK**, Default: `gen_random_uuid()`)
  * `email` (`character varying`, **UNIQUE**, **NOT NULL**)
  * `password` (`character varying`, **NOT NULL**)
  * `created_at` (`timestamp with time zone`, Default: `now()`)
  * `username` (`character varying`)
  * `total_xp` (`bigint`, Default: `0`, Check: `total_xp >= 0`)
  * `current_streak` & `longest_streak` (`integer`, Default: `0`, Check: `>= 0`)
  * `last_active_date` (`date`)
  * `cached_vocab_count` & `cached_collocation_count` (`integer`, Default: `0`)
  * `avatar_url` (`text`)

### 🔐 `public.sessions`
*Manages secure user session refresh tokens.*

* **Columns:**
  * `id` (`uuid`, **PK**)
  * `user_id` (`uuid`, **FK** ➔ `public.users(id)`)
  * `refresh_token` (`text`, **UNIQUE**, **NOT NULL**)
  * `expires_at` (`timestamp with time zone`, **NOT NULL**)
  * `created_at` (`timestamp with time zone`, Default: `now()`)

---

## 📖 **3. VOCABULARY & COLLOCATION REPOSITORIES**

### 🌟 `public.global_words`
*Master repository for English vocabulary, phonetics, parts of speech, and rich JSON metadata.*

* **Columns:**
  * `id` (`uuid`, **PK**)
  * `word` & `slug` (`character varying`, **UNIQUE**, **NOT NULL**)
  * `pos` (`character varying`) — *Part of speech (e.g., noun, verb)*
  * `ipa` (`character varying`) — *Phonetic transcription*
  * `word_family` & `prefix_suffix` (`jsonb`) — *Morphological breakdown*
  * `context_sentence` (`character varying`)
  * `collocations` (`jsonb`)
  * `meaning` (`text`)
  * `audio_url` (`text`)
  * `created_at` (`timestamp with time zone`)

### 🔗 `public.word_relations` & 🎒 `public.user_vocabularies`
* **`word_relations`**: Maps relationships between words (*synonyms, derivatives, roots*). Connects `parent_word_id` and `child_word_id` to `global_words(id)`.
* **`user_vocabularies`**: Tracks spaced-repetition learning status (`learning`, `review`, etc.), intervals, and ease factors for individual users.

### 🧩 `public.global_collocations`
*Repository for common English collocations, phrases, and community learning stories.*

* **Columns:**
  * `id` (`uuid`, **PK**)
  * `phrase` (`character varying`, **UNIQUE**, **NOT NULL**)
  * `type` (`character varying`, Default: `'collocation'`)
  * `meaning` (`text`, **NOT NULL**)
  * `pattern` & `topic` (`character varying`, **NOT NULL**)
  * `cefr_level` (`character varying`, Default: `'A1'`)
  * `drill_variations`, `phase1_translation`, `community_sentences`, `community_stories` (`jsonb`)
  * `audio_url` (`text`)

---

## 📝 **4. WRITING & GAMIFICATION ANALYTICS**

### ✍️ `public.writing_sessions`
*Stores student essay submissions, AI-evaluated IELTS band scores, and detailed tutor feedback.*

* **Key Columns:**
  * `id` (`uuid`, **PK**)
  * `user_id` (`uuid`, **NOT NULL**)
  * `prompt_topic` & `essay_type` (`character varying`)
  * `question_text` & `user_essay` (`text`, **NOT NULL**)
  * `user_outline` & `tutor_feedback` (`jsonb`)
  * `overall_band`, `task_achievement_score`, `coherence_cohesion_score`, `lexical_resource_score`, `grammar_score` (`numeric`, **NOT NULL**)
  * `upgraded_essay` (`text`, **NOT NULL**)
  * `status` (`character varying`, Default: `'COMPLETED'`)

### 🏅 Supporting Tables
* **`user_daily_activities`**: Tracks daily XP earned, words learned, and words reviewed.
* **`user_badges`**: Stores unlocked achievements (`badge_code`, `unlocked_at`).
* **`user_feedbacks`**: Collects ratings (`smallint`) and comments per feature.
* **`api_key_states`**: Monitors AI model rate limits and token usage (`tpm_count`, `tpd_count`).

---

## 🗺️ **5. GRAMMAR QUEST MODULE ARCHITECTURE** *(Core Feature)*

Designed for step-by-step slide-deck theory and multi-stage interactive mini-games (`puzzle`, `error`, `speed`, `transformer`, `context`).

### 1️⃣ `public.grammar_topics` *(Major Chapters)*
```sql
CREATE TABLE public.grammar_topics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  title character varying NOT NULL,
  category character varying,
  description text,
  level character varying NOT NULL CHECK (level::text = ANY (ARRAY['Cơ bản'::character varying, 'Trung bình'::character varying, 'Nâng cao'::character varying, 'Chuyên sâu'::character varying]::text[])),
  badge_color character varying,
  icon_bg character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT grammar_topics_pkey PRIMARY KEY (id)
);
```

### 2️⃣ `public.grammar_sub_topics` *(Lessons)*
> *Contains the complete interactive slide deck theory (`formulas`, `usageSignals`, `examples`, `traps`) stored inside the `theory_content` JSONB column.*
```sql
CREATE TABLE public.grammar_sub_topics (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL,
  title character varying NOT NULL,
  description text,
  theory_content jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT grammar_sub_topics_pkey PRIMARY KEY (id),
  CONSTRAINT fk_grammar_sub_topics_topic FOREIGN KEY (topic_id) REFERENCES public.grammar_topics(id) ON DELETE CASCADE
);
```

### 3️⃣ `public.grammar_game_stages` *(Mini-game Campaigns)*
```sql
CREATE TABLE public.grammar_game_stages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sub_topic_id uuid NOT NULL,
  title character varying NOT NULL,
  game_type character varying NOT NULL CHECK (game_type::text = ANY (ARRAY['puzzle'::character varying, 'error'::character varying, 'speed'::character varying, 'transformer'::character varying, 'context'::character varying]::text[])),
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT grammar_game_stages_pkey PRIMARY KEY (id),
  CONSTRAINT fk_grammar_game_stages_sub_topic FOREIGN KEY (sub_topic_id) REFERENCES public.grammar_sub_topics(id) ON DELETE CASCADE
);
```

### 4️⃣ `public.grammar_questions` *(Question Bank)*
> *Utilizes a polymorphic `payload` JSONB column to adapt seamlessly to all 5 game types.*
```sql
CREATE TABLE public.grammar_questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL,
  question_type character varying NOT NULL CHECK (question_type::text = ANY (ARRAY['puzzle'::character varying, 'error'::character varying, 'speed'::character varying, 'transformer'::character varying, 'context'::character varying]::text[])),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_index integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT grammar_questions_pkey PRIMARY KEY (id),
  CONSTRAINT fk_grammar_questions_stage FOREIGN KEY (stage_id) REFERENCES public.grammar_game_stages(id) ON DELETE CASCADE
);
```

### 5️⃣ `public.user_grammar_progress` *(Mastery Tracking)*
```sql
CREATE TABLE public.user_grammar_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  topic_id uuid NOT NULL,
  sub_topic_id uuid NOT NULL,
  progress_percentage integer DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
  is_mastered boolean DEFAULT false,
  last_score integer DEFAULT 0 CHECK (last_score >= 0),
  is_locked boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_grammar_progress_pkey PRIMARY KEY (id),
  CONSTRAINT fk_user_grammar_progress_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_grammar_progress_topic FOREIGN KEY (topic_id) REFERENCES public.grammar_topics(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_grammar_progress_sub_topic FOREIGN KEY (sub_topic_id) REFERENCES public.grammar_sub_topics(id) ON DELETE CASCADE,
  CONSTRAINT user_subtopic_unique UNIQUE (user_id, sub_topic_id)
);
```

---

## ⚙️ **6. SYSTEM FUNCTIONS & TRIGGERS**

| Name | Type | Target Table / Event | Description |
| :--- | :--- | :--- | :--- |
| **`handle_new_user`** | Trigger / Definer | `auth.users` / `public.users` | *Initializes user records upon sign-up.* |
| **`log_user_activity`** | Function | *Invoker* | *Calculates XP and updates daily activity streaks.* |
| **`sync_user_vocab_count`** | Trigger / Invoker | `user_vocabularies` (`AFTER INSERT/DELETE`) | *Synchronizes cached vocabulary counters.* |
| **`sync_user_vocab_and_collocation_count`** | Trigger / Invoker | `user_vocabularies` (`AFTER INSERT/DELETE`) | *Synchronizes vocabulary & collocation counts.* |
| **`update_grammar_timestamp_column`** | Function | *Invoker* | *Automatically refreshes `updated_at` timestamps.* |
| **`trg_grammar_topics_updated_at`** | Trigger (`BEFORE UPDATE`) | `grammar_topics` | *Triggers timestamp update on topic edits.* |
| **`trg_grammar_sub_topics_updated_at`** | Trigger (`BEFORE UPDATE`) | `grammar_sub_topics` | *Triggers timestamp update on lesson edits.* |
| **`trg_user_grammar_progress_updated_at`** | Trigger (`BEFORE UPDATE`) | `user_grammar_progress` | *Triggers timestamp update on progress changes.* |
