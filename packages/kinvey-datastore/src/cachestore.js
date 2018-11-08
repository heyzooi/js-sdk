import isArray from 'lodash/isArray';
import { KinveyObservable } from 'kinvey-observable';
import { Query } from 'kinvey-query';
import { KinveyError, NotFoundError } from 'kinvey-errors';
import { getConfig } from 'kinvey-app';
import { DataStoreCache } from './cache';
import { Sync } from './sync';
import { NetworkStore } from './networkstore';

const NAMESPACE = 'appdata';

export class CacheStore {
  constructor(collectionName, options = { tag: undefined, useDeltaSet: false, useAutoPagination: false, autoSync: true }) {
    this.collectionName = collectionName;
    this.tag = options.tag;
    this.useDeltaSet = options.useDeltaSet === true;
    this.useAutoPagination = options.useAutoPagination === true || options.autoPagination;
    this.autoSync = options.autoSync === true;
  }

  get pathname() {
    const { appKey } = getConfig();
    return `/${NAMESPACE}/${appKey}/${this.collectionName}`;
  }


  find(query, options = {}) {
    const autoSync = options.autoSync === true || this.autoSync;
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const stream = KinveyObservable.create(async (observer) => {
      try {
        const cachedDocs = await cache.find(query);
        observer.next(cachedDocs);
        if (autoSync) {
          await this.pull(query, options);
          const docs = await cache.find(query);
          observer.next(docs);
        }

        observer.complete();
      } catch (error) {
        observer.error(error);
      }
    });
    return stream;
  }

  count(query, options = {}) {
    const autoSync = options.autoSync === true || this.autoSync;
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const stream = KinveyObservable.create(async (observer) => {
      try {
        const cacheCount = await cache.count(query);
        observer.next(cacheCount);

        if (autoSync) {
          const network = new NetworkStore(this.collectionName);
          const count = await network.count(query, options).toPromise();
          observer.next(count);
        }

        observer.complete();
      } catch (error) {
        observer.error(error);
      }
    });
    return stream;
  }

  group(aggregation, options = {}) {
    const autoSync = options.autoSync === true || this.autoSync;
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const stream = KinveyObservable.create(async (observer) => {
      try {
        const cacheResult = await cache.group(aggregation);
        observer.next(cacheResult);

        if (autoSync) {
          const network = new NetworkStore(this.collectionName);
          const networkResult = await network.group(aggregation, options).toPromise();
          observer.next(networkResult);
        }

        observer.complete();
      } catch (error) {
        observer.error(error);
      }
    });
    return stream;
  }

  findById(id, options = {}) {
    const autoSync = options.autoSync === true || this.autoSync;
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const stream = KinveyObservable.create(async (observer) => {
      try {
        // if (!id) {
        //   throw new Error('No id was provided. A valid id is required.');
        // }

        if (!id) {
          observer.next(undefined);
        } else {
          const cachedDoc = await cache.findById(id);

          if (!cachedDoc) {
            if (!autoSync) {
              throw new NotFoundError();
            }

            observer.next(undefined);
          } else {
            observer.next(cachedDoc);
          }

          if (autoSync) {
            const query = new Query().equalTo('_id', id);
            await this.pull(query, options);
            const doc = await cache.findById(id);
            observer.next(doc);
          }
        }

        observer.complete();
      } catch (error) {
        observer.error(error);
      }
    });
    return stream;
  }

  async create(doc, options = {}) {
    if (isArray(doc)) {
      throw new KinveyError('Unable to create an array of entities.', 'Please create entities one by one.');
    }

    const autoSync = options.autoSync === true || this.autoSync;
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const sync = new Sync(this.collectionName, this.tag);
    const cachedDoc = await cache.save(doc);
    await sync.addCreateSyncEvent(cachedDoc);

    if (autoSync) {
      const query = new Query().equalTo('_id', cachedDoc._id);
      const pushResults = await this.push(query, options);
      const pushResult = pushResults.shift();

      if (pushResult.error) {
        throw pushResult.error;
      }

      return pushResult.entity;
    }

    return cachedDoc;
  }

  async update(doc, options = {}) {
    if (isArray(doc)) {
      throw new KinveyError('Unable to update an array of entities.', 'Please update entities one by one.');
    }

    if (!doc._id) {
      throw new KinveyError('The entity provided does not contain an _id. An _id is required to update the entity.', doc);
    }

    const autoSync = options.autoSync === true || this.autoSync;
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const sync = new Sync(this.collectionName, this.tag);
    const cachedDoc = await cache.save(doc);
    await sync.addUpdateSyncEvent(cachedDoc);

    if (autoSync) {
      const query = new Query().equalTo('_id', cachedDoc._id);
      const pushResults = await this.push(query, options);
      const pushResult = pushResults.shift();

      if (pushResult.error) {
        throw pushResult.error;
      }

      return pushResult.entity;
    }

    return cachedDoc;
  }

  save(doc, options) {
    if (doc._id) {
      return this.update(doc, options);
    }

    return this.create(doc, options);
  }

  async remove(query, options = {}) {
    const autoSync = options.autoSync === true || this.autoSync;
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const sync = new Sync(this.collectionName, this.tag);
    let count = 0;

    // Find the docs that will be removed from the cache that match the query
    const docs = await cache.find(query);

    if (docs.length > 0) {
      // Remove docs from the cache
      count = await cache.remove(query);

      // Add delete events for the removed docs to sync
      const syncDocs = await sync.addDeleteSyncEvent(docs);

      // Remove the docs from the backend
      if (syncDocs.length > 0 && autoSync) {
        const pushQuery = new Query().contains('_id', syncDocs.map(doc => doc._id));
        const pushResults = await this.push(pushQuery);
        count = pushResults.reduce((count, pushResult) => {
          if (pushResult.error) {
            return count - 1;
          }

          return count;
        }, count);
      }
    }

    return { count };
  }

  async removeById(id, options = {}) {
    const autoSync = options.autoSync === true || this.autoSync;
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const sync = new Sync(this.collectionName, this.tag);
    let count = 0;

    if (id) {
      // Find the doc that will be removed
      const doc = await cache.findById(id);

      if (!doc) {
        throw new NotFoundError();
      }

      // Remove the doc from the cache
      count = await cache.removeById(id);

      // Add delete event for the removed doc to sync
      const syncDoc = await sync.addDeleteSyncEvent(doc);

      // Remove the doc from the backend
      if (syncDoc && autoSync) {
        const query = new Query().equalTo('_id', doc._id);
        const pushResults = await this.push(query);

        if (pushResults.length > 0) {
          const pushResult = pushResults.shift();
          if (pushResult.error) {
            count -= 1;
          }
        }
      }
    }

    return { count };
  }

  async clear(query) {
    // Remove the sync events
    const sync = new Sync(this.collectionName, this.tag);
    await sync.remove(query);

    // Remove the docs from the cache
    const cache = new DataStoreCache(this.collectionName, this.tag);
    const count = await cache.remove(query);
    return { count };
  }

  async push(query, options) {
    const sync = new Sync(this.collectionName, this.tag);
    return sync.push(query, options);
  }

  async pull(query, options = {}) {
    const useDeltaSet = options.useDeltaSet === true || this.useDeltaSet;
    const useAutoPagination = options.useAutoPagination === true || options.autoPagination || this.useAutoPagination;
    const autoSync = options.autoSync === true || this.autoSync;
    const sync = new Sync(this.collectionName, this.tag);

    // Push sync queue
    const count = await sync.count();
    if (count > 0) {
      // TODO in newer version
      // if (autoSync) {
      //   await sync.push();
      //   return this.pull(query, Object.assign({}, { useDeltaSet, useAutoPagination, autoSync }, options));
      // }

      if (count === 1) {
        throw new KinveyError(`Unable to pull entities from the backend. There is ${count} entity`
          + ' that needs to be pushed to the backend.');
      }

      throw new KinveyError(`Unable to pull entities from the backend. There are ${count} entities`
        + ' that need to be pushed to the backend.');
    }

    // Delta Set
    if (useDeltaSet) {
      return sync.deltaset(query, Object.assign({}, { useDeltaSet, useAutoPagination, autoSync }, options));
    }

    // Auto Paginate
    if (useAutoPagination) {
      return sync.autopaginate(query, Object.assign({}, { useDeltaSet, useAutoPagination, autoSync }, options));
    }

    // Regular sync pull
    return sync.pull(query, options);
  }

  async sync(query, options) {
    const push = await this.push(null, options);
    const pull = await this.pull(query, options);
    return { push, pull };
  }

  pendingSyncDocs(query) {
    const sync = new Sync(this.collectionName, this.tag);
    return sync.find(query);
  }

  pendingSyncEntities(query) {
    return this.pendingSyncDocs(query);
  }

  pendingSyncCount(query) {
    const sync = new Sync(this.collectionName, this.tag);
    return sync.count(query);
  }

  clearSync(query) {
    const sync = new Sync(this.collectionName, this.tag);
    return sync.remove(query);
  }

  async subscribe(receiver) {
    const network = new NetworkStore(this.collectionName);
    await network.subscribe(receiver);
    return this;
  }

  async unsubscribe() {
    const network = new NetworkStore(this.collectionName);
    await network.unsubscribe();
    return this;
  }
}
