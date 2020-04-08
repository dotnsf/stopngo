//. app.js

var express = require( 'express' ),
    bodyParser = require( 'body-parser' ),
    cloudantlib = require( '@cloudant/cloudant' ),
    ejs = require( 'ejs' ),
    fs = require( 'fs' ),
    jwt = require( 'jsonwebtoken' ),
    OAuth = require( 'oauth' ),
    request = require( 'request' ),
    session = require( 'express-session' ),
    Twitter = require( 'twitter' ),
    settings = require( './settings' ),
    app = express();

var db = null;
var db_url = 'https://' + settings.cloudant_username + '.cloudant.com/dashboard.html';
var cloudant = cloudantlib( { account: settings.cloudant_username, password: settings.cloudant_password } );
if( cloudant ){
  cloudant.db.get( settings.cloudant_dbname, function( err, body ){
    if( err ){
      if( err.statusCode == 404 ){
        cloudant.db.create( settings.cloudant_dbname, function( err, body ){
          if( err ){
            db = null;
          }else{
            db = cloudant.db.use( settings.cloudant_dbname );

            //. query index
            var query_index_owner = {
              _id: "_design/library",
              language: "query",
              indexes: {
                "owner-index": {
                  index: {
                    fields: [ { name: "owner", type: "string" } ]
                  },
                  type: "text"
                }
              }
            };
            db.insert( query_index_owner, function( err, body ){} );
          }
        });
      }else{
        db = cloudant.db.use( settings.cloudant_dbname );

        //. query index
        var query_index_owner = {
          _id: "_design/library",
          language: "query",
          indexes: {
            "owner-index": {
              index: {
                fields: [ { name: "owner", type: "string" } ]
              },
              type: "text"
            }
          }
        };
        db.insert( query_index_owner, function( err, body ){} );
      }
    }else{
      db = cloudant.db.use( settings.cloudant_dbname );

      //. query index
      var query_index_owner = {
        _id: "_design/library",
        language: "query",
        indexes: {
          "owner-index": {
            index: {
              fields: [ { name: "owner", type: "string" } ]
            },
            type: "text"
          }
        }
      };
      db.insert( query_index_owner, function( err, body ){} );
    }
  });
}

app.use( bodyParser.urlencoded( { extended: true } ) );
app.use( bodyParser.json() );
app.use( express.Router() );
app.use( express.static( __dirname + '/public' ) );

app.set( 'views', __dirname + '/views' );
app.set( 'view engine', 'ejs' );

app.use( session({
  secret: settings.superSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,           //. https で使う場合は true
    maxage: 1000 * 60 * 60   //. 60min
  }
}) );


//. Twitter API
var oa = new OAuth.OAuth(
  'https://api.twitter.com/oauth/request_token',
  'https://api.twitter.com/oauth/access_token',
  settings.twitter_consumer_key,
  settings.twitter_consumer_secret,
  '1.0A',
  null,
  'HMAC-SHA1'
);

app.get( '/twitter', function( req, res ){
  oa.getOAuthRequestToken( function( err, oauth_token, oauth_token_secret, results ){
    if( err ){
      console.log( err );
      res.redirect( '/' );
    }else{
      req.session.oauth = {};
      req.session.oauth.token = oauth_token;
      req.session.oauth.token_secret = oauth_token_secret;
      res.redirect( 'https://twitter.com/oauth/authenticate?oauth_token=' + oauth_token );
    }
  });
});

app.get( '/twitter/callback', function( req, res ){
  if( req.session.oauth ){
    req.session.oauth.verifier = req.query.oauth_verifier;
    var oauth = req.session.oauth;
    oa.getOAuthAccessToken( oauth.token, oauth.token_secret, oauth.verifier, function( err, oauth_access_token, oauth_access_token_secret, results ){
      if( err ){
        console.log( err );
        res.redirect( '/' );
      }else{
        req.session.oauth.provider = 'twitter';
        req.session.oauth.user_id = results.user_id;
        req.session.oauth.screen_name = results.screen_name;
        req.session.oauth.access_token = oauth_access_token;
        req.session.oauth.access_token_secret = oauth_access_token_secret;
        //console.log( req.session.oauth );

        var token = jwt.sign( req.session.oauth, settings.superSecret, { expiresIn: '25h' } );
        req.session.token = token;

        res.redirect( '/' );
      }
    });
  }else{
    res.redirect( '/' );
  }
});

app.post( '/logout', function( req, res ){
  req.session.token = null;
  //res.redirect( '/' );
  res.write( JSON.stringify( { status: true }, 2, null ) );
  res.end();
});


app.get( '/', function( req, res ){
  var user = null;
  if( req.session && req.session.token ){
    var token = req.session.token;
    jwt.verify( token, settings.superSecret, function( err, user0 ){
      if( user0 ){
        user = user0;
      }
      res.render( 'index', { user: user } );
    });
  }else{
    res.render( 'index', { user: user } );
  }
});

app.get( '/document/:id', async function( req, res ){
  var id = req.params.id;
  var user = null;
  var Doc = await getDocById( id, req );
  if( Doc.doc ){
    Doc.doc.created = timestamp2datetime( Doc.doc.created );
    Doc.doc.updated = timestamp2datetime( Doc.doc.updated );
  }
  if( req.session && req.session.token ){
    var token = req.session.token;
    jwt.verify( token, settings.superSecret, function( err, user0 ){
      if( user0 ){
        user = user0;
      }
      res.render( 'document', { user: user, id: id, status: Doc.status, doc: Doc.doc, editable: Doc.editable, error: Doc.error } );
    });
  }else{
    res.render( 'document', { user: user, id: id, status: Doc.status, doc: Doc.doc, editable: Doc.editable, error: Doc.error } );
  }
});

app.get( '/doc/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var id = req.params.id;

  var Doc = await getDocById( id, req );
  if( Doc.doc ){
    res.write( JSON.stringify( { status: true, doc: Doc.doc } ) );
    res.end();
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, doc: null, error: Doc.error } ) );
    res.end();
  }
});

app.get( '/docs', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    if( req.session && req.session.token ){
      var token = req.session.token;
      jwt.verify( token, settings.superSecret, function( err, oauth ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          //db.search( 'library', 'owner-index', { q: oauth.screen_name }, function( err, result ){
          db.find( { selector: { owner: { "$eq": oauth.screen_name } }, fields: [ "_id", "_rev", "owner", "permitted_users", "content", "created", "updated" ] }, function( err, result ){
            if( err ){
              console.log( err );
              res.status( 400 );
              res.write( JSON.stringify( { status: false, error: err } ) );
              res.end();
            }else{
              //console.log( result ); //. { docs: [ { _id: '_id', _rev: '_rev', owner: 'owner', .. }, .. ] }
              res.write( JSON.stringify( { status: true, docs: result.docs } ) );
              res.end();
            }
          });
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: "no session found." } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: "db not initialized." } ) );
    res.end();
  }
});

app.post( '/doc', function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  if( db ){
    if( req.session && req.session.token ){
      var token = req.session.token;
      jwt.verify( token, settings.superSecret, function( err, oauth ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          var ts = ( new Date() ).getTime();
          var permitted_users = req.body.permitted_users;
          if( !permitted_users ){ permitted_users = []; }
          var content = req.body.content;
          var doc = {
            //owner: { id: oauth.user_id, screen_name: oauth.screen_name },
            owner: oauth.screen_name,
            permitted_users: permitted_users,
            content: content,
            created: ts,
            updated: ts
          };

          db.insert( doc, function( err, body, header ){
            if( err ){
              res.status( 400 );
              res.write( JSON.stringify( { status: false, error: err } ) );
              res.end();
            }else{
              res.write( JSON.stringify( { status: true, doc: body } ) );
              res.end();

              /* HashchainSolo 更新 */
              var doc0 = JSON.parse( JSON.stringify( doc ) );
              doc0['action'] = 'POST /doc';
              PostHashchainSolo( doc0 ).then( function( r ){} );
            }
          });
        }
      });
    }else{
      res.status( 400 );
      res.write( JSON.stringify( { status: false, error: "no token found." } ) );
      res.end();
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: "db not initialized." } ) );
    res.end();
  }
});

app.put( '/doc/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var id = req.params.id;
  var Doc = await getDocById( id, req );
  if( Doc.doc ){
    var doc = Doc.doc;
    if( doc.owner && Doc.editable ){
      doc.updated = ( new Date() ).getTime();
      var permitted_users = req.body.permitted_users;
      if( !permitted_users ){ permitted_users = []; }
      doc.permitted_users = req.body.permitted_users;
      if( 'content' in req.body ){
        doc.content = req.body.content;
      }

      db.insert( doc, function( err, body, header ){
        if( err ){
          res.status( 400 );
          res.write( JSON.stringify( { status: false, error: err } ) );
          res.end();
        }else{
          res.write( JSON.stringify( { status: true, doc: body } ) );
          res.end();

          /* HashchainSolo 更新 */
          var doc0 = JSON.parse( JSON.stringify( doc ) );
          doc0['action'] = 'PUT /doc';
          PostHashchainSolo( doc0 ).then( function( r ){} );
        }
      });
    }
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: "id and/or db is null." } ) );
    res.end();
  }
});

app.delete( '/doc/:id', async function( req, res ){
  res.contentType( 'application/json; charset=utf-8' );

  var id = req.params.id;
  var Doc = await getDocById( id, req );
  if( Doc.doc && Doc.editable ){
    var rev = Doc.doc._rev;
    db.destroy( id, rev, function( err, body, header ){
      if( err ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, error: err } ) );
        res.end();
      }else{
        res.write( JSON.stringify( { status: true } ) );
        res.end();

        /* HashchainSolo 更新 */
        var doc0 = JSON.parse( JSON.stringify( Doc.doc ) );
        doc0['action'] = 'DELETE /doc';
        PostHashchainSolo( doc0 ).then( function( r ){} );
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, error: "id and/or db is null." } ) );
    res.end();
  }
});

app.get( '/profileimage', function( req, res ){
  var screen_name = req.query.screen_name;
  if( screen_name ){
    var option = {
      url: 'https://twitter.com/' + screen_name + '/profile_image?size=original',
      method: 'GET'
    };
    request( option, ( err0, res0, body0 ) => {
      if( err0 ){
        return res.status( 403 ).send( { status: false, error: err0 } );
      }else{
        res.redirect( 'https://pbs.twimg.com' + res0.request.path );
      }
    });
  }else{
    return res.status( 403 ).send( { status: false, error: 'No screen_name provided.' } );
  }
});

app.get( '/ledgers', function( req, res ){
  res.contentType( 'application/json' );

  if( settings.hashchainsolo_url ){
    var option = {
      url: settings.hashchainsolo_url + '/validate',
      method: 'GET'
    };

    request( option, ( err0, res0, body0 ) => {
      if( err0 ){
        res.status( 400 );
        res.write( JSON.stringify( { status: false, message: err0 }, 2, null ) );
        res.end();
      }else{
        body0 = JSON.parse( body0 );
        res.write( JSON.stringify( { status: true, docs: body0.docs, validation: body0.validateResult }, 2, null ) );
        res.end();
      }
    });
  }else{
    res.status( 400 );
    res.write( JSON.stringify( { status: false, message: 'no blockchain configuration.' }, 2, null ) );
    res.end();
  }
});

//. タイムスタンプを年月日時分秒に変換
function timestamp2datetime( ts ){
  var dt = new Date( ts );
  var yyyy = dt.getFullYear();
  var mm = dt.getMonth() + 1;
  var dd = dt.getDate();
  var hh = dt.getHours();
  var nn = dt.getMinutes();
  var ss = dt.getSeconds();
  var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
    + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
  //var datetime = yyyy + '年' + mm + '月' + dd + '日';
  return datetime;
}

//. オーナーが無効(Disabled)の状態かを判定
function isOwnerDisabled( user_status ){
  if( user_status == null ){
    //. オーナー情報が見つからなかった場合は Disalbed とみなす
    return true;
  }else if( ( 'suspended' in user_status ) && user_status.suspended == true ){
    //. オーナー情報が見つかり、suspended 属性が true の場合は Disalbed とみなす
    return true;
  }else{
    //. 他は Disabled とはみなさない
    return false;
  }
}

function getDocById( doc_id, req ){
  return new Promise( async function( resolve, reject ){
    if( db && doc_id ){
      db.get( doc_id, { include_docs: true }, async function( err, doc ){
        if( err ){
          resolve( { doc: null, status: false, editable: false, error: err } );
        }else{
          //. doc をそのまま返してよいかどうかの判断
          var owner_screen_name = doc.owner;
          var owner_status = await getUserStatus( owner_screen_name, req );
          if( req.session && req.session.token ){
            var token = req.session.token;
            jwt.verify( token, settings.superSecret, function( err, oauth ){
              if( err ){
                //. 未ログイン状態 : doc が公開モードで、かつオーナーアカウントが無効の場合のみ公開
                if( isOwnerDisabled( owner_status ) && doc.permitted_users.length == 0 ){
                  resolve( { doc: doc, status: true, editable: false, error: null } );
                }else{
                  resolve( { doc: null, status: false, editable: false, error: 'no permission' } );
                }
              }else{
                if( oauth ){
                  if( oauth.screen_name == owner_screen_name ){
                    //. オーナー本人によるアクセス : アクセス可
                    resolve( { doc: doc, status: true, editable: true, error: null } );
                  }else{
                    //. オーナー以外のユーザーからのアクセス : doc が公開モードまたはプライベートだが権限があって、かつオーナーアカウントが無効の場合のみ公開
                    if( isOwnerDisabled( owner_status ) && ( doc.permitted_users.length == 0 || doc.permitted_users.indexOf( oauth.screen_name ) > -1 ) ){
                      resolve( { doc: doc, status: true, editable: false, error: null } );
                    }else{
                      resolve( { doc: null, status: false, editable: false, error: 'no permission' } );
                    }
                  }
                }else{
                  //. jwt.verify エラー : doc が公開モードで、かつオーナーアカウントが無効の場合のみ公開
                  if( isOwnerDisabled( owner_status ) && doc.permitted_users.length == 0 ){
                    resolve( { doc: doc, status: true, editable: false, error: null } );
                  }else{
                    resolve( { doc: null, status: false, editable: false, error: 'no permission' } );
                  }
                }
              }
            });
          }else{
            //. 未ログイン状態 : doc が公開モードで、かつオーナーアカウントが無効の場合のみ公開
            if( isOwnerDisabled( owner_status ) && doc.permitted_users.length == 0 ){
              resolve( { doc: doc, status: true, editable: false, error: null } );
            }else{
              resolve( { doc: null, status: false, editable: false, error: 'no permission' } );
            }
          }
        }
      });
    }else{
      resolve( { doc: null, status: false, editable: false, error: 'no permission' } );
    }
  });
}

function getUserStatus( target_user_screen_name, req ){
  return new Promise( async function( resolve, reject ){
    if( req.session && req.session.token ){
      var token = req.session.token;
      jwt.verify( token, settings.superSecret, async function( err, oauth ){
        if( err ){
          resolve( null );
        }else{
          if( oauth ){
            var client = new Twitter({
              consumer_key: settings.twitter_consumer_key,
              consumer_secret: settings.twitter_consumer_secret,
              access_token_key: oauth.oauth_access_token,
              access_token_secret: oauth.oauth_access_token_secret
            });
            var params = { screen_name: target_user_screen_name };
            client.get( 'users/show', params, async function( err, tweets, status ){
              //console.log( err );
              if( err ){
                resolve( null );
              }else{
                //. https://syncer.jp/Web/API/Twitter/REST_API/GET/users/show/
                resolve( status );
              }
            });
          }else{
            resolve( null );
          }
        }
      });
    }else{
      resolve( null );
    }
  });
}

function PostHashchainSolo( body ){
  return new Promise( function( resolve, reject ){
    if( settings.hashchainsolo_url ){
      /* バイナリデータの場合はハッシュ化する
      var sha512 = crypto.createHash( 'sha512' );
      sha512.update( JSON.stringify( body ) );
      var hash = sha512.digest( 'hex' );
      */

      var option = {
        url: settings.hashchainsolo_url + '/doc',
        method: 'POST',
        json: body   //. これで {.., body: body, ..} として登録される
      };

      if( body.owner ){
        //. 暗号化してしまうと、複号できる人が存在しなくなってしまうのでしない
      }

      request( option, ( err0, res0, body0 ) => {
        if( err0 ){
          console.log( err0 );
          logger.system.error( JSON.stringify( err0 ) );
          resolve( false );
        }else{
          console.log( body0 );
          resolve( true );
        }
      });
    }else{
      console.log( 'PostHashchainSolo: HashchainSolo not enabled.' );
      resolve( false );
    }
  });
}

function timestamp2datetime( ts ){
  var dt = new Date( ts );
  var yyyy = dt.getFullYear();
  var mm = dt.getMonth() + 1;
  var dd = dt.getDate();
  var hh = dt.getHours();
  var nn = dt.getMinutes();
  var ss = dt.getSeconds();
  var datetime = yyyy + '-' + ( mm < 10 ? '0' : '' ) + mm + '-' + ( dd < 10 ? '0' : '' ) + dd
    + ' ' + ( hh < 10 ? '0' : '' ) + hh + ':' + ( nn < 10 ? '0' : '' ) + nn + ':' + ( ss < 10 ? '0' : '' ) + ss;
  return datetime;
}

var port = process.env.port || 8080;
app.listen( port );
console.log( "server stating on " + port + " ..." );
console.log( "DB: " + db_url );
