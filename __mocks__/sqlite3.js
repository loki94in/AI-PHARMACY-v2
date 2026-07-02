// Mock sqlite3 module for testing purposes
// We avoid using jest.fn() because this module might be loaded before jest is set up
const mockDb = {
  exec: () => {},
  prepare: () => ({
    bind: () => ({
      get: () => {},
      all: () => {},
      run: () => {},
      finalize: () => {}
    })
  }),
  close: () => {},
  serialize: (callback) => callback(),
  parallelize: (callback) => callback()
};

export default {
  Database: class {
    constructor(filename, mode, callback) {
      if (typeof mode === 'function') {
        callback = mode;
      }
      if (callback) callback(null);
    }

    exec(sql, callback) {
      if (callback) callback(null);
    }

    prepare(sql) {
      return {
        bind: (...args) => {
          return {
            get: (callback) => {
              if (callback) callback(null, {});
              return this;
            },
            all: (callback) => {
              if (callback) callback(null, []);
              return this;
            },
            run: (callback) => {
              if (callback) callback(null);
              return this;
            },
            finalize: () => {}
          };
        }
      };
    }

    close(callback) {
      if (callback) callback(null);
    }
  },
  verbose: () => {
    return {
      Database: this.Database,
      OPEN_READONLY: this.OPEN_READONLY,
      OPEN_READWRITE: this.OPEN_READWRITE,
      OPEN_CREATE: this.OPEN_CREATE
    };
  },
  OPEN_READONLY: 1,
  OPEN_READWRITE: 2,
  OPEN_CREATE: 4
};