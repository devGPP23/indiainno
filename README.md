# CivicSync

An AI-powered municipal grievance redressal and anti-corruption platform that bridges the gap between citizens and government authorities.

## 🚀 Features

### For Citizens
* **AI Voice Complaints:** Speak your complaint naturally. Our AI automatically transcribes your voice (via Sarvam AI) and categorizes the department, severity, and location (via Groq LLM).
* **Live Location Mapping:** Drop a pin exactly where the issue is using Mapbox integration.
* **Anonymous Whistleblowing:** Securely report corruption with cryptographic tracking IDs to follow up without revealing your identity.
* **Citizen Dashboard:** Track the live status of all your submitted complaints.

### For Government Officers
* **City Heatmaps:** Visualize complaint hotspots across the city to allocate resources effectively.
* **AI Implementation Plans:** Generate step-by-step action plans, required materials, and budget estimates for resolving complex civic issues instantly.
* **Automated Routing:** Tickets are automatically assigned to the correct municipal department (Water, PWD, Health, etc.) based on AI classification.

## 🛠 Tech Stack

* **Frontend:** React 19, Vite, Tailwind CSS, Mapbox GL JS
* **Backend:** Node.js, Express, MongoDB Atlas (Mongoose)
* **AI Integration:** Sarvam AI (Speech-to-Text), Groq (Llama 3 for text classification)
* **Authentication:** JWT-based stateless authentication

## 💻 Local Development

### 1. Clone the repository
```bash
git clone https://github.com/devGPP23/indiainno.git
cd indiainno
```

### 2. Environment Variables
Create a `.env` file in the **root** directory and the **`backend/`** directory.

**Root `.env`:**
```env
VITE_API_BASE_URL=http://localhost:5000/api
VITE_MAPBOX_TOKEN=your_mapbox_token
```

**Backend `backend/.env`:**
```env
PORT=5000
MONGO_URI=your_mongodb_atlas_uri
JWT_SECRET=your_jwt_secret
SARVAM_API_KEY=your_sarvam_api_key
GROQ_API_KEY=your_groq_api_key
```

### 3. Install Dependencies & Run
You will need to run the backend and frontend simultaneously.

**Backend:**
```bash
cd backend
npm install
npm start
```

**Frontend:**
```bash
# In the root directory
npm install
npm run dev
```

## 🌐 Deployment Guide

### Backend (Render)
1. Create a new Web Service on Render.
2. Set the Root Directory to `backend`.
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Add all environment variables from `backend/.env`.

### Frontend (Vercel)
1. Import the repository into Vercel.
2. The framework preset should auto-detect as **Vite**.
3. Add your `VITE_MAPBOX_TOKEN`.
4. Update `VITE_API_BASE_URL` to point to your live Render backend URL (e.g., `https://your-backend.onrender.com/api`).
