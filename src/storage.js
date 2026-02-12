const fs = require('node:fs');
const path = require('node:path');
const { MongoClient } = require('mongodb');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'user-secrets.json');

function createStorage(config) {
  let mongoClient = null;
  let mongoCollection = null;
  const isMongoEnabled = Boolean(config.mongodbUri);

  function buildMongoClientOptions(tlsValue) {
    const options = {
      serverSelectionTimeoutMS: config.mongodbServerSelectionTimeoutMs,
      tls: tlsValue
    };

    if (config.mongodbTlsAllowInvalidCertificates) {
      options.tlsAllowInvalidCertificates = true;
    }

    return options;
  }

  async function connectMongo(tlsValue) {
    const options = buildMongoClientOptions(tlsValue);
    const client = new MongoClient(config.mongodbUri, options);
    await client.connect();
    const collection = client.db(config.mongodbDb).collection(config.mongodbCollection);
    await collection.createIndex({ userId: 1 }, { unique: true });
    return { client, collection, options };
  }

  async function initStorage() {
    if (!isMongoEnabled) {
      console.log('Storage mode: local file JSON.');
      return;
    }

    try {
      const result = await connectMongo(config.mongodbTls);
      mongoClient = result.client;
      mongoCollection = result.collection;
      console.log(`Storage mode: MongoDB (${config.mongodbDb}.${config.mongodbCollection}) with tls=${result.options.tls}.`);
      return;
    } catch (error) {
      const canAutoFlipTls = !config.mongodbTlsExplicit && !config.mongodbUri.startsWith('mongodb+srv://');

      if (canAutoFlipTls) {
        const flippedTls = !config.mongodbTls;
        console.warn(`MongoDB connect failed with tls=${config.mongodbTls}, retrying with tls=${flippedTls}...`);

        try {
          const retried = await connectMongo(flippedTls);
          mongoClient = retried.client;
          mongoCollection = retried.collection;
          console.warn(`MongoDB connected after TLS auto-flip (tls=${retried.options.tls}).`);
          return;
        } catch (retryError) {
          console.warn(`MongoDB retry with tls=${flippedTls} failed:`, retryError.message);
        }
      }

      console.warn('MongoDB unavailable, fallback to local JSON store:', error.message);
      console.warn('Tip (Railway): set MONGODB_TLS=true/false explicitly if your Mongo service requires a specific TLS mode.');
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
