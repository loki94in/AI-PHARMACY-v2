import sqlite3 from 'sqlite3';

const OriginalDatabase = sqlite3.Database;

// Wrap sqlite3.Database constructor to enforce WAL mode and busy_timeout
(sqlite3 as any).Database = function(filename: string, ...args: any[]) {
  let mode: any;
  let callback: any;
  
  if (args.length === 1) {
    if (typeof args[0] === 'function') {
      callback = args[0];
    } else {
      mode = args[0];
    }
  } else if (args.length >= 2) {
    mode = args[0];
    callback = args[1];
  }

  const wrappedCallback = (err: any) => {
    if (err) {
      if (callback) callback(err);
      return;
    }
    
    // Set journal_mode, busy_timeout, and performance tunings immediately on opening
    db.serialize(() => {
      db.run('PRAGMA journal_mode = WAL;', (err1) => {
        if (err1) {
          if (callback) callback(err1);
          return;
        }
        db.run('PRAGMA busy_timeout = 10000;');
        db.run('PRAGMA cache_size = -16000;');
        db.run('PRAGMA temp_store = MEMORY;');
        db.run('PRAGMA synchronous = NORMAL;', (err2) => {
          if (callback) callback(err2 || null);
        });
      });
    });
  };

  const db = mode !== undefined
    ? new OriginalDatabase(filename, mode, wrappedCallback)
    : new OriginalDatabase(filename, wrappedCallback);

  return db;
};

// Inherit prototype and static properties
Object.setPrototypeOf(sqlite3.Database, OriginalDatabase);
sqlite3.Database.prototype = OriginalDatabase.prototype;
