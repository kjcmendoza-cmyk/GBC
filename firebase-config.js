import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    getDocs,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    doc,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getAuth,
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyAzMJzt0n9_Rdnz-FEPK_VrHxQ-7XfD2TA",
    authDomain: "gbc-business.firebaseapp.com",
    projectId: "gbc-business",
    storageBucket: "gbc-business.firebasestorage.app",
    messagingSenderId: "750031263819",
    appId: "1:750031263819:web:e3f83275f529f4d10f15ce",
    measurementId: "G-YVL1WKTK4N"
};

// Set to true for local browser-only testing, false for live Firebase
export const DEMO_MODE = false;

let db, auth, storage;

if (!DEMO_MODE) {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    storage = getStorage(app);
}

export const DbService = {
    async saveOrder(orderData) {
        if (DEMO_MODE) {
            const orders = JSON.parse(localStorage.getItem('gbc_orders') || '[]');
            orders.unshift({
                id: orderData.ticketId,
                ...orderData,
                createdAt: new Date().toISOString()
            });
            localStorage.setItem('gbc_orders', JSON.stringify(orders));
            return orderData.ticketId;
        }
        const docRef = await addDoc(collection(db, "bookings"), {
            ...orderData,
            createdAt: new Date()
        });
        return docRef.id;
    },
async updateOrderDetails(id, newQty, newTotal, newMaterial = null) {
    if (DEMO_MODE) {
        const orders = JSON.parse(localStorage.getItem('gbc_orders') || '[]');
        const idx = orders.findIndex(o => o.id === id);
        if (idx > -1 && orders[idx].details) {
            orders[idx].details.qty = newQty;
            orders[idx].details.total = newTotal;
            if (newMaterial !== null) orders[idx].details.material = newMaterial;
        }
        localStorage.setItem('gbc_orders', JSON.stringify(orders));
        return;
    }
    const updates = {
        "details.qty": newQty,
        "details.total": newTotal
    };
    if (newMaterial !== null) {
        updates["details.material"] = newMaterial;
    }
    await updateDoc(doc(db, "bookings", id), updates);
},

    async getAvailability() {
        if (DEMO_MODE) {
            const data = localStorage.getItem('gbc_availability');
            return data ? JSON.parse(data) : {};
        }
        const snap = await getDoc(doc(db, "settings", "availability"));
        return snap.exists() ? snap.data() : {};
    },

    async saveAvailability(availabilityMap) {
        if (DEMO_MODE) {
            localStorage.setItem('gbc_availability', JSON.stringify(availabilityMap));
            return;
        }
        await setDoc(doc(db, "settings", "availability"), availabilityMap);
    },
    async getOrders(statusFilter = "All") {
        if (DEMO_MODE) {
            let orders = JSON.parse(localStorage.getItem('gbc_orders') || '[]');
            if (statusFilter !== "All") {
                orders = orders.filter(o => o.status === statusFilter);
            }
            return orders;
        }
        // Single-field orderBy avoids composite index errors while sorting newest first
        const q = query(collection(db, "bookings"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        let orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        if (statusFilter !== "All") {
            orders = orders.filter(o => o.status === statusFilter);
        }
        return orders;
    },

    async updateOrderStatus(id, newStatus) {
        if (DEMO_MODE) {
            const orders = JSON.parse(localStorage.getItem('gbc_orders') || '[]');
            const idx = orders.findIndex(o => o.id === id);
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
        const snap = await getDoc(doc(db, "settings", "global"));
        return snap.exists() ? snap.data() : null;
    },

    async saveSettings(settings) {
        if (DEMO_MODE) {
            localStorage.setItem('gbc_settings', JSON.stringify(settings));
            return;
        }
        await setDoc(doc(db, "settings", "global"), settings);
    },

    async uploadHaulingPhoto(blob, ticketId = 'misc', index = 1) {
        if (DEMO_MODE) {
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('Failed to encode photo'));
                reader.readAsDataURL(blob);
            });
        }

        const storageRef = ref(storage, `hauling-photos/${ticketId}/photo-${index}-${Date.now()}.jpg`);
        await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });
        return await getDownloadURL(storageRef);
    },

    async getBlockedDates() {
        if (DEMO_MODE) {
            return JSON.parse(localStorage.getItem('gbc_blocked_dates') || '[]');
        }
        const q = query(collection(db, "blocked_dates"), orderBy("date", "asc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    },

    async addBlockedDate(blockData) {
        if (DEMO_MODE) {
            const list = JSON.parse(localStorage.getItem('gbc_blocked_dates') || '[]');
            const item = { id: 'blk_' + Date.now(), ...blockData };
            list.push(item);
            localStorage.setItem('gbc_blocked_dates', JSON.stringify(list));
            return item.id;
        }
        const docRef = await addDoc(collection(db, "blocked_dates"), {
            ...blockData,
            createdAt: new Date()
        });
        return docRef.id;
    },

    async deleteBlockedDate(id) {
        if (DEMO_MODE) {
            const list = JSON.parse(localStorage.getItem('gbc_blocked_dates') || '[]')
                .filter(item => item.id !== id);
            localStorage.setItem('gbc_blocked_dates', JSON.stringify(list));
            return;
        }
        await deleteDoc(doc(db, "blocked_dates", id));
    }
};

export const AuthService = {
    login: async (email, password) => {
        if (DEMO_MODE) return { user: { email } };
        return await signInWithEmailAndPassword(auth, email, password);
    },
    logout: async () => {
        if (DEMO_MODE) return;
        return await signOut(auth);
    },
    onAuthChange: (callback) => {
        if (DEMO_MODE) {
            const isAuth = localStorage.getItem('gbc_admin_auth') === 'true';
            callback(isAuth ? { email: 'demo@gbc.local' } : null);
            return () => {};
        }
        return onAuthStateChanged(auth, callback);
    }
};