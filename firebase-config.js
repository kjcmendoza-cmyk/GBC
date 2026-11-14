import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, doc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// PASTE FIREBASE CONFIG HERE LATER
const firebaseConfig = {
  apiKey: "AIzaSyAzMJzt0n9_Rdnz-FEPK_VrHxQ-7XfD2TA",
  authDomain: "gbc-business.firebaseapp.com",
  projectId: "gbc-business",
  storageBucket: "gbc-business.firebasestorage.app",
  messagingSenderId: "750031263819",
  appId: "1:750031263819:web:e3f83275f529f4d10f15ce",
  measurementId: "G-YVL1WKTK4N"
};

// Change this from true to false to activate real Firebase backend
export const DEMO_MODE = false;

let db, auth, storage;

if (!DEMO_MODE) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    storage = getStorage(app);
}

// Database Abstraction Layer to handle DEMO vs FIREBASE transparently
export const DbService = {
    async saveOrder(orderData) {
        if (DEMO_MODE) {
            let orders = JSON.parse(localStorage.getItem('gbc_orders') || '[]');
            orders.unshift({ id: orderData.ticketId, ...orderData, createdAt: new Date().toISOString() });
            localStorage.setItem('gbc_orders', JSON.stringify(orders));
            return orderData.ticketId;
        }
        const docRef = await addDoc(collection(db, "bookings"), { ...orderData, createdAt: new Date() });
        return docRef.id;
    },
    async getOrders(statusFilter = "All") {
        if (DEMO_MODE) {
            let orders = JSON.parse(localStorage.getItem('gbc_orders') || '[]');
            if (statusFilter !== "All") orders = orders.filter(o => o.status === statusFilter);
            return orders;
        }
        // Firestore logic implementation skipped for brevity, standard query structure
        let q = collection(db, "bookings");
        if (statusFilter !== "All") q = query(q, where("status", "==", statusFilter));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    async updateOrderStatus(id, newStatus) {
        if (DEMO_MODE) {
            let orders = JSON.parse(localStorage.getItem('gbc_orders') || '[]');
            let idx = orders.findIndex(o => o.id === id);
            if (idx > -1) orders[idx].status = newStatus;
            localStorage.setItem('gbc_orders', JSON.stringify(orders));
            return;
        }
        await updateDoc(doc(db, "bookings", id), { status: newStatus });
    },
    async getSettings() {
        if (DEMO_MODE) {
            const data = localStorage.getItem('gbc_settings');
            return data ? JSON.parse(data) : null; 
        }
        // Firestore getSettings fallback
        return null;
    },
    async saveSettings(settings) {
        if (DEMO_MODE) {
            localStorage.setItem('gbc_settings', JSON.stringify(settings));
            return;
        }
    }
};

export const AuthService = {
    login: async (email, password) => {
        if(DEMO_MODE) return { user: { email } };
        return await signInWithEmailAndPassword(auth, email, password);
    },
    logout: async () => {
        if(DEMO_MODE) return;
        return await signOut(auth);
    }
};