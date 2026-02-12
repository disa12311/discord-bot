const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'user-secrets.json');

function createStorage(config) {
  let mongoClient = null;
  let mongoCollection = null;
  const isMongoEnabled = Boolean(config.mongodbUri);

  async function initStorage() {
    if (!isMongoEnabled) {
      console.log('Storage mode: local file JSON.');
      return;
    }

    try {
      const mongoClientOptions = {
        serverSelectionTimeoutMS: config.mongodbServerSelectionTimeoutMs
      };

      if (typeof config.mongodbTls === 'boolean') {
        mongoClientOptions.tls = config.mongodbTls;
      }

      if (config.mongodbTlsAllowInvalidCertificates) {
        mongoClientOptions.tlsAllowInvalidCertificates = true;
      }

      mongoClient = new MongoClient(config.mongodbUri, mongoClientOptions);
      await mongoClient.connect();
      mongoCollection = mongoClient.db(config.mongodbDb).collection(config.mongodbCollection);
      await mongoCollection.createIndex({ userId: 1 }, { unique: true });
      console.log(`Storage mode: MongoDB (${config.mongodbDb}.${config.mongodbCollection}).`);
    } catch (error) {
      console.error('MongoDB connection failed, fallback to local JSON store:', error.message);
      console.error('Tip: check MONGODB_TLS / MONGODB_TLS_ALLOW_INVALID_CERTIFICATES if your server has TLS constraints.');
      mongoClient = null;
      mongoCollection = null;
    }
  }

  function ensureDataFile() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
    }
  }

  async function readStore() {
    if (mongoCollection) {
      const docs = await mongoCollection.find({}).toArray();
      const store = {};

      for (const doc of docs) {
        const { _id, userId, ...userData } = doc;
        if (userId) {
          store[userId] = userData;
        }
      }

      return store;
    }

    ensureDataFile();

    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      const backup = `${DATA_FILE}.broken.${Date.now()}`;

      try {
        fs.copyFileSync(DATA_FILE, backup);
      } catch (copyError) {
        console.error('Failed to backup broken store file:', copyError);
      }

      fs.writeFileSync(DATA_FILE, JSON.stringify({}, null, 2));
      console.error('Store file was corrupted. Reinitialized empty store. Backup:', backup);
      return {};
    }
  }

  async function writeStore(store) {
    if (mongoCollection) {
      const operations = Object.entries(store).map(([userId, userData]) => ({
        replaceOne: {
          filter: { userId },
          replacement: { userId, ...userData },
          upsert: true
        }
      }));

      if (operations.length > 0) {
        await mongoCollection.bulkWrite(operations, { ordered: false });
      }
      return;
    }

    ensureDataFile();
    const tempPath = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
    fs.renameSync(tempPath, DATA_FILE);
  }

  return {
    initStorage,
    readStore,
    writeStore
  };
}

module.exports = {
  createStorage
};
