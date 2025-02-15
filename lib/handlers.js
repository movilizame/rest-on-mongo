const JSONStream = require('JSONStream');
const qpm = require('query-params-mongo');
const mongodb = require('mongodb');

const processQuery = qpm({
  autoDetect: [{ fieldPattern: /_id$/, dataType: 'objectId' }],
  converters: { objectId: mongodb.ObjectID }
});

async function checkUser(req) {
    console.log(req.user);
    if(req.user){
      const user = await req.db.collection('users').findOne({_id: mongodb.ObjectId("" + req.user?.id)});
      if(user && req.user){
        return true;
      }else{
        return false;
      }
    }else{
      return true;
    }
}

async function handleCreateOne(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const doc = req.body;
    doc._id = req.id;
    const response = await req.collection.insertOne(doc);
    const { result, insertedCount, insertedIds } = response;
    res.send({ result, insertedCount, insertedIds });
  } catch (e) {
    next(e);
  }
}

async function handleCreateMany(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const docs = Array.isArray(req.body) ? req.body : [req.body];
    const response = await req.collection.insertMany(docs);
    const { result, insertedCount, insertedIds } = response;
    res.send({ result, insertedCount, insertedIds });
  } catch (e) {
    next(e);
  }
}
function transformSingleElementFileToObj(element, arrayKey, item_id, collectionName) {
  if (Object.hasOwnProperty.call(element, arrayKey) && arrayKey.indexOf('_type') > 0) {
    const base64Key = arrayKey.replace('_type', '');
    // data:image/jpeg;base64
    console.log('before split', typeof element[arrayKey] === 'string');
    if (typeof element[arrayKey] === 'string') {
      try {
        const type = element[arrayKey]?.split(':')[1]?.split('/')[1]?.replace(';base64', '');
        const file = element[arrayKey]?.split(':')[1]?.split('/')[0];
        const url = '/file/' + collectionName + '/' + item_id + '/' + file + '/' + type + '/' + base64Key;
        element[base64Key + '_linked'] = url;
        delete element[base64Key];
      } catch (ex) {
        console.log('ex handle', ex);
      }
    }
  }
}

function transformFilesInObj(item, collectionName) {
  for (const key in item) {
    if (Object.hasOwnProperty.call(item, key) && Array.isArray(item[key])) {
      item[key].forEach(element => {
        for (const arrayKey in element) {
          transformSingleElementFileToObj(element, arrayKey, item._id, collectionName);
        }
      });
    } else {
      transformSingleElementFileToObj(item, key, item._id, collectionName);
    }
  }
}
async function handleGetOne(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const obj = await req.collection.findOne({ _id: req.id });
    console.log("req");
    console.log(user);

    if (!obj) {
      res.status(404).send({});
    } else {
      transformFilesInObj(obj, req.collection.collectionName);
      res.send(obj);
    }
  } catch (e) {
    next(e);
  }
}

async function handleGetMany(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const q = processQuery(req.query);
    // eslint-disable-next-line no-underscore-dangle
    const filter = req.query.__filter ? JSON.parse(req.query.__filter) : q.filter;
    const cursor = req.collection.find(filter).sort(q.sort).skip(q.skip).limit(q.limit);
    // cursor.pipe(JSONStream.stringify()).pipe(res.type('json'));
    const arr = await cursor.toArray();
    // _type
    if (arr && arr.length) {
      arr.forEach((item) => {
        transformFilesInObj(item, req.collection.collectionName);
      });
    }
    res.send(arr);
  } catch (e) {
    next(e);
  }
}

async function handleUpdateOne(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const response = await req.collection.updateOne({ _id: req.id }, { $set: req.body });
    const { result, matchedCount, modifiedCount } = response;
    if (matchedCount !== 1) {
      res.status(404);
    }
    res.send({ result, matchedCount, modifiedCount });
  } catch (e) {
    next(e);
  }
}

async function handleGetOneFile(req, res, next) {

  res.writeHead(200, {
    'Content-Type': req.params.file + '/' + req.params.type,
    'Content-Transfer-Encoding': 'binary'
  });
  const collection = req.db.collection(req.params.collectionName);
  const obj = await collection.findOne({ _id: mongodb.ObjectID('' + req.params.object_id) });
  console.log(obj);
  if(obj){
    console.log("HERE");
    console.log(req.params.prop);
    if (typeof obj[req.params.prop] === 'string') {
      let binary = Buffer.from(obj[req.params.prop], 'base64');
      res.end(binary);
    } else if(Array.isArray(obj[req.params.prop]) && obj[req.params.prop][req.params.number]) {
      console.log('typeof', obj[req.params.prop][req.params.number]);
      if(obj[req.params.prop][req.params.number][req.params.prop]){
        let binary = Buffer.from(obj[req.params.prop][req.params.number][req.params.prop], 'base64');
        res.end(binary);
      }else{
        res.end("file not found");
      }
    } 
    else {
      res.end(obj[req.params.prop].buffer);
    }
  }else{
    res.end("file not found");
  }
}

async function handleUpdateMany(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const ops = [];
    for (let i = 0; i < req.body.length; i += 1) {
      const object = req.body[i];
      const { _id } = object;
      if (!_id) {
        res.status(400).send({
          status: 'error',
          statusCode: 400,
          message: `Missing _id in update (index ${i})`,
        });
        return;
      }
      delete object._id; // eslint-disable-line no-param-reassign
      ops.push({
        updateOne: {
          filter: { _id },
          update: { $set: object },
        },
      });
    }
    const response = await req.collection.bulkWrite(ops);
    const { result, matchedCount, modifiedCount } = response;
    res.send({ result, matchedCount, modifiedCount });
  } catch (e) {
    next(e);
  }
}

async function handleReplaceOne(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const response = await req.collection.replaceOne({ _id: req.id }, req.body);
    const { result, matchedCount, modifiedCount } = response;
    if (matchedCount !== 1) {
      res.status(404);
    }
    res.send({ result, matchedCount, modifiedCount });
  } catch (e) {
    next(e);
  }
}

async function handleReplaceMany(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const ops = [];
    for (let i = 0; i < req.body.length; i += 1) {
      const object = req.body[i];
      const { _id } = object;
      if (!_id) {
        res.status(400).send({
          status: 'error',
          statusCode: 400,
          message: `Missing _id in update (index ${i})`,
        });
        return;
      }
      delete object._id; // eslint-disable-line no-param-reassign
      ops.push({
        replaceOne: {
          filter: { _id },
          replacement: object,
          upsert: true,
        },
      });
    }
    const response = await req.collection.bulkWrite(ops);
    const { result, matchedCount, modifiedCount } = response;
    res.send({ result, matchedCount, modifiedCount });
  } catch (e) {
    next(e);
  }
}

async function handleDeleteOne(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const response = await req.collection.deleteOne({ _id: req.id });
    const { result, deletedCount } = response;
    if (deletedCount !== 1) {
      res.status(404);
    }
    res.send({ result, deletedCount });
  } catch (e) {
    next(e);
  }
}

async function handleDeleteMany(req, res, next) {
  try {
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const filter = req.query.__filter // eslint-disable-line no-underscore-dangle
      ? JSON.parse(req.query.__filter) // eslint-disable-line no-underscore-dangle
      : processQuery(req.query).filter;
    const response = await req.collection.deleteMany(filter);
    const { result, deletedCount } = response;
    res.send({ result, deletedCount });
  } catch (e) {
    next(e);
  }
}

async function handleUploadPicture(req, res, next){
  try{
    const user = await checkUser(req);
    if(!user){
      throw new Error('User non existing');
    }
    const collection = req.db.collection(req.params.collectionName);
    const obj = await collection.findOne({ _id: mongodb.ObjectID('' + req.params.object_id) });
    if(!obj[req.params.prop]){
      obj[req.params.prop] = [];
    }
    let updated = {};
    updated[req.params.prop] = obj[req.params.prop].concat(req.body.images);
    const response = await collection.updateOne({ _id: mongodb.ObjectID('' + req.params.object_id) }, { $set: updated });
    res.send(response);
  } catch(e) {
    console.log(e);
    next(e);
  }

}

module.exports = {
  handleCreateOne,
  handleCreateMany,
  handleGetOne,
  handleGetMany,
  handleUpdateOne,
  handleUpdateMany,
  handleReplaceOne,
  handleReplaceMany,
  handleDeleteOne,
  handleDeleteMany,
  handleGetOneFile,
  handleUploadPicture
};
