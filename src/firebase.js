import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC0r6nti52BvQNNauwnhQt22ypGAOUm8QM",
  authDomain: "nicoplan-app.firebaseapp.com",
  databaseURL: "https://nicoplan-app-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "nicoplan-app",
  storageBucket: "nicoplan-app.firebasestorage.app",
  messagingSenderId: "670902992248",
  appId: "1:670902992248:web:c75f977e1b37bd46981c8d"
};

const app = initializeApp(firebaseConfig);

export const db = getDatabase(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
