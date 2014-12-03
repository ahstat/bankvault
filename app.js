// Load the app :
// npm install
// foreman start web
// localhost:5000

var http = require('http'),
  url = require('url'),
  fs = require('fs'),
  ent = require('ent'), // to prevent users to use html code
  shortid = require('shortid'),
  express = require('express'),
  request = require('request'),
  mongoClient = require('mongodb').MongoClient;

var vault_num = 0, // number of vaults opened
  true_pass = 0, // current pass to find
  pass_found = []; // list of cracked passes

var num_players = 0; // number of players

// Helper functions
// function to get a new vault
var new_vault = function() {
  if(vault_num > 0) {
    pass_found[pass_found.length] = true_pass;
  }
  vault_num++;
  true_pass =  Math.floor(10000*Math.random());
  console.log('>>> New secret pass: ' + true_pass + ' <<<');
  //console.log('List of cracked passes ' + pass_found);
}

// function when a player found a pass
var new_vault_player = function(socket) {
  if(vault_num < 10000) {
    new_vault();
    socket.message = '<p> Vault ' + (vault_num-1) + ' is now open...' +
                      vault_num + ' is the new vault to enter! </p>';
    socket.broadcast.emit('send_html', {message: socket.message});
    // socket.emit('send_html', {message: socket.message});
  } 
  else {
    console.log('>>> End of the game <<<');
    true_pass = -1;
  }
}

// Server initialization
new_vault();

var app = express();

app.get('/index.html', function(req, res) {
  fs.readFile('./index.html', 'utf-8', function(error, content) {
    res.writeHead(200, {"Content-Type": "text/html"});
    res.end(content);
  });
});

app.get('/about.html', function(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.end('Hello everybody, everybody hello, hello everybody, everybody hello.');
});

app.use(function(req, res, next){
  res.redirect('/index.html');
});

app.set('port', (process.env.PORT || 5000))

// http://stackoverflow.com/questions/17696801/express-js-app-listen-vs-server-listen
var server = app.listen(app.get('port'));

// Loading and using socket.io
var io = require('socket.io').listen(server);

//mongoClient.connect("mongodb://127.0.0.1:27017/mydb", function(err, db) {
mongoClient.connect(MONGOLAB_BANK, function(err, db) {

  io.sockets.on('connection', function (socket) { // each socket is linked to a player
    num_players++
    console.log('Now ' + num_players + ' player(s).');
          socket.message = '<p> Now ' + num_players + ' player(s).';
          socket.emit('send_html', {message: socket.message});
          socket.broadcast.emit('send_html', {message: socket.message});

    // id 
    socket.id_player = shortid.generate();

    // ip
    /*
    //10.151.81.194
    console.log(socket.client.conn.remoteAddress);
    console.log(socket.conn.remoteAddress);
    console.log(socket.handshake.address);
    console.log(socket.request.socket._peername.address);
    console.log(socket.request.connection._peername.address);
    console.log(socket.request.client._peername.address);
    */
    /*
    // 4:0.0.0.0:41403
    console.log(socket.server.httpServer._connectionKey);
    console.log(socket.request.socket.server._connectionKey);
    console.log(socket.request.connection.server._connectionKey);
    console.log(socket.request.client.server._connectionKey);
    */
    //console.dir(socket);
    //console.dir(socket.handshake.headers['x-forwarded-for']);
    socket.ip_player = socket.handshake.headers['x-forwarded-for'];
   if (!socket.ip_player){
      socket.ip_player = socket.conn.remoteAddress;
    } 

    // Country
    // socket.ip_player = undefined; // this line checks that there is no error when the ip is undefined
    socket.url = 'http://ipinfo.io/'+ socket.ip_player + '/json';
    request(socket.url, function(error, response, html) {
      if(!error) {
        // http://stackoverflow.com/questions/7988726/extracting-json-data
        try {
          var parsed = JSON.parse(html);
          socket.country = parsed.country
        }
        catch(e) {
          socket.country = undefined;
        }
      }
    });

    // Checking a pass proposition
    socket.on('pass_proposition', function (pass_to_test) {
      // http://stackoverflow.com/questions/4059147/check-if-a-variable-is-a-string
      if(typeof pass_to_test == 'string' || pass_to_test instanceof String) {
        socket.pass = parseInt(ent.encode(String(pass_to_test)), 10); //ent, then conversion to base 10
        if(socket.pass > -0.5 & socket.pass < 9999.5) {
          socket.newDate = Date.now()/1000; //date in seconds

          console.log('( date: ' + Math.floor(socket.newDate) + ' / pass: ' + socket.pass +
                      ' / vault_num: ' + vault_num + ' / id: ' + socket.id_player + 
                      ' / ip: ' + socket.ip_player + ' / pays: ' + socket.country + ')');

          //mongo connexion
          var attempts = db.collection("attempts");
          /*
          setInterval(function() {
            attempts.count(function(err, count) {
              console.log("---------------------------- " + count + " ----------------------------");
            });
          }, 10000);
          */
          var attempt = {};
          attempt.date = socket.newDate;
          attempt.id = socket.id_player;
          attempt.ip = socket.ip_player;
          attempt.country = socket.country;
          attempt.pass = socket.pass;
          attempt.vault_num = vault_num;

          attempts.insert(attempt, function(err, doc) {
            if (err) {
              console.log("Failed to insert attempt");
            }
            console.log("Inserted attempt ");
          });
          //mongo connexion end

          socket.win_vault_num = 0;

          if(socket.pass == true_pass) {
            socket.message = '<p><strong>' + socket.pass + 
                             '</strong> is the correct password for the vault n°' +
                             vault_num + '! Congratulations.</p>';
            socket.emit('send_html', {message: socket.message});

            socket.win_vault_num = vault_num;
            socket.emit('ask_nickname');
            new_vault_player(socket);
          }
          else {
            socket.message = '<p><strong>' + socket.pass + '</strong> nop </p>';
            socket.emit('send_html', {message: socket.message});
          }
        }
      }
    }); 


    // Asking the nickname when the player wins
    socket.on('send_nickname', function(nickname) {
      if(socket.win_vault_num > 0) {
        if(nickname == null) { 
          nickname = 'anonymous'; 
        }
        else if( !(typeof nickname == 'string' || nickname instanceof String) ) {
          nickname = 'anonymous'; 
        }

        socket.nickname = ent.encode(nickname);         
        socket.message = '<p>The player who broke the vault n°' + socket.win_vault_num +
                         ' is... <strong>' + socket.nickname + '</strong>! </p>';

        //mongo connexion
        var wins = db.collection("wins");

        var win = {};
        win.date = socket.newDate;
        win.id = socket.id_player;
        win.ip = socket.ip_player;
        win.country = socket.country;
        win.pass = socket.pass;
        win.vault_num = socket.win_vault_num;
        win.nickname = socket.nickname;
  
        wins.insert(win, function(err, doc) {
          if (err) {
            console.log("Failed to insert win");
          }
          console.log("Inserted win");
        });
        //mongo connexion end
  
        socket.win_vault_num = 0;
        socket.emit('send_html', {message: socket.message});
        socket.broadcast.emit('send_html', {message: socket.message});
      }
      else {
        // not in accordance with the code
      }
    });
  
    // Disconnection of a player
    // http://stackoverflow.com/questions/10342548/socket-io-disconnect-event-isnt-fired
    socket.on('disconnect', function () {
      num_players--
      console.log('Now ' + num_players + ' player(s).');
          socket.message = '<p> Now ' + num_players + ' player(s).';
          socket.emit('send_html', {message: socket.message});
          socket.broadcast.emit('send_html', {message: socket.message});
  
    });
  });
});
