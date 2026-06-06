import { openDB } from 'idb';

const DB_NAME = 'SynapseDB';
const DB_VERSION = 1;

export const initDB = async () => {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            // Store for file metadata (fileId, fileName, fileType, fileSize, sender, totalChunks, status)
            if (!db.objectStoreNames.contains('files_metadata')) {
                db.createObjectStore('files_metadata', { keyPath: 'fileId' });
            }
            // Store for binary chunks
            if (!db.objectStoreNames.contains('file_chunks')) {
                db.createObjectStore('file_chunks', { keyPath: ['fileId', 'chunkIndex'] });
            }
            // Store for fully reassembled blobs
            if (!db.objectStoreNames.contains('files_blob')) {
                db.createObjectStore('files_blob', { keyPath: 'fileId' });
            }
        },
    });
};

export const saveFileMetadata = async (metadata) => {
    const db = await initDB();
    await db.put('files_metadata', metadata);
};

export const getFileMetadata = async (fileId) => {
    const db = await initDB();
    return await db.get('files_metadata', fileId);
};

export const getAllFilesMetadata = async () => {
    const db = await initDB();
    return await db.getAll('files_metadata');
};

export const saveFileChunk = async (fileId, chunkIndex, dataArray) => {
    const db = await initDB();
    await db.put('file_chunks', { fileId, chunkIndex, data: dataArray });
};

export const getFileChunk = async (fileId, chunkIndex) => {
    const db = await initDB();
    return await db.get('file_chunks', [fileId, chunkIndex]);
};

export const getAllFileChunks = async (fileId) => {
    const db = await initDB();
    const tx = db.transaction('file_chunks', 'readonly');
    const store = tx.objectStore('file_chunks');
    const allChunks = await store.getAll();
    return allChunks.filter(chunk => chunk.fileId === fileId).sort((a, b) => a.chunkIndex - b.chunkIndex);
};

export const saveFileBlob = async (fileId, blob) => {
    const db = await initDB();
    await db.put('files_blob', { fileId, blob });
};

export const getFileBlob = async (fileId) => {
    const db = await initDB();
    return await db.get('files_blob', fileId);
};

export const clearSessionFiles = async () => {
    // Optionally clean up the database when leaving
    const db = await initDB();
    const tx = db.transaction(['files_metadata', 'file_chunks', 'files_blob'], 'readwrite');
    await tx.objectStore('files_metadata').clear();
    await tx.objectStore('file_chunks').clear();
    await tx.objectStore('files_blob').clear();
    await tx.done;
};
