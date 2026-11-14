// 5. js/davao-data.js
import { DbService, DEMO_MODE } from './firebase-config.js';

export const DefaultData = {
    barangays: [
        { name: "Poblacion District (Flat)", fee: 0 },
        { name: "Agdao District (Flat)", fee: 0 },
        { name: "Buhangin District (Flat)", fee: 0 },
        { name: "Talomo District (Flat)", fee: 0 },
        { name: "Toril (Outer)", fee: 500 },
        { name: "Tugbok (Outer)", fee: 500 },
        { name: "Calinan (Outer)", fee: 1000 },
        { name: "Waan (HQ / Free)", fee: 0 }
    ],
    materials: [
        { id: "sand", name: "Washed Sand", price: 1500, inStock: true },
        { id: "gravel", name: "Crushed Gravel", price: 1800, inStock: true },
        { id: "escombro", name: "Filling (Escombro)", price: 1200, inStock: true }
    ],
    rates: {
        haulingBase: 1500,
        backhoeDaily: 4500,
        backhoeAddon: 1500, // loading fee for hauling
        haulingAddon: 1200  // hauling fee for rentals
    },
    fleet: {
        backhoes: 2,
        trucks: 4
    }
};

let currentData = null;

export async function getAppData() {
    if (currentData) return currentData;
    const remoteData = await DbService.getSettings();
    if (remoteData) {
        currentData = remoteData;
    } else {
        currentData = JSON.parse(JSON.stringify(DefaultData));
        if(DEMO_MODE) await DbService.saveSettings(currentData);
    }
    return currentData;
}