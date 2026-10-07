import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "firebase/auth";
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  type DocumentSnapshot,
  type Firestore
} from "firebase/firestore";
import type { BoardBackend, DocSnapshotLike } from "./backend";

/** Public web config of the existing Firebase project (it is in the old app's page source too). */
export const firebaseConfig = {
  apiKey: "AIzaSyCq4dqoSiAe-_mAVxBGOkuS8U54-xZgoNs",
  authDomain: "o-tacos-gantt.firebaseapp.com",
  projectId: "o-tacos-gantt",
  storageBucket: "o-tacos-gantt.firebasestorage.app",
  messagingSenderId: "255539789734",
  appId: "1:255539789734:web:fe6d85009c029b61fdd967",
  measurementId: "G-22GLYLHKKD"
};

function wrap(snapshot: DocumentSnapshot): DocSnapshotLike {
  return {
    exists: () => snapshot.exists(),
    data: () => snapshot.data() as Record<string, unknown> | undefined
  };
}

/** Real Firebase v11 backend. Nothing is contacted until a method is called. */
export function createFirebaseBackend(config: typeof firebaseConfig = firebaseConfig): BoardBackend {
  let app: FirebaseApp | null = null;
  let db: Firestore | null = null;
  const getApp = (): FirebaseApp => {
    if (!app) app = getApps()[0] ?? initializeApp(config);
    return app;
  };
  const getDb = (): Firestore => {
    if (!db) db = getFirestore(getApp());
    return db;
  };
  const ref = (path: string) => doc(getDb(), path);

  return {
    kind: "firebase",
    async signIn(email, password) {
      await signInWithEmailAndPassword(getAuth(getApp()), email, password);
    },
    async signOut() {
      await signOut(getAuth(getApp()));
    },
    onAuthStateChanged(listener) {
      return onAuthStateChanged(getAuth(getApp()), (user) =>
        listener(user ? { email: user.email, isAnonymous: user.isAnonymous } : null)
      );
    },
    async getDoc(path) {
      return wrap(await getDoc(ref(path)));
    },
    async setDoc(path, data, options) {
      if (options) await setDoc(ref(path), data, options);
      else await setDoc(ref(path), data);
    },
    onSnapshot(path, onNext, onError) {
      return onSnapshot(ref(path), (snapshot) => onNext(wrap(snapshot)), onError);
    },
    runTransaction(updateFn) {
      return runTransaction(getDb(), (transaction) =>
        updateFn({
          async get(path) {
            return wrap(await transaction.get(ref(path)));
          },
          set(path, data, options) {
            if (options) transaction.set(ref(path), data, options);
            else transaction.set(ref(path), data);
          }
        })
      );
    },
    serverTimestamp: () => serverTimestamp()
  };
}
