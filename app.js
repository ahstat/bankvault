var http = require('http'),
  url = require('url'),
  fs = require('fs'),
  ent = require('ent'), // to prevent users to use html code
  shortid = require('shortid'),
  express = require('express'),
  request = require('request'),
  mongoClient = require('mongodb').MongoClient,
  mongoose = require('mongoose');

var vault_num = 0, // number of vaults opened
  true_pass = 0; // current pass to find

var num_players = 0; // number of players

// http://stackoverflow.com/questions/13200810/getting-herokus-config-vars-to-work-in-node-js
//mongoose.connect("mongodb://127.0.0.1:27017/mydb", function(err) {
mongoose.connect("mongodb://" + process.env.MONGOLAB_BANK_USER + 
                 ":" + process.env.MONGOLAB_BANK_PASS + 
                 "@ds057000.mongolab.com:57000/bankvault", function(err) {
  if(err) {
    throw err;
  }
});

// http://atinux.developpez.com/tutoriels/javascript/mongodb-nodejs-mongoose/
// schema creation
var attemptsSchema = new mongoose.Schema({
  date : { },
  id : { },
  ip : { },
  country : { },
  pass : { },
  vault_num : { }
});
// model creation
var AttemptsModel = mongoose.model('attempts', attemptsSchema);

var winsSchema = new mongoose.Schema({
  date : { },
  id : { },
  ip : { },
  country : { },
  pass : { },
  vault_num : { },
  nickname : { }
});
var WinsModel = mongoose.model('wins', winsSchema);

var passesSchema = new mongoose.Schema({
  vault_num : { },
  pass : { }
});
var PassesModel = mongoose.model('passes', passesSchema);

// Helper functions
// function to get a new vault
var new_vault = function() {
  if(vault_num > 0) { // a vault is open, during the game
    console.log("New vault, new pass to get !");
    add_new_vault();
  }

  if(vault_num == 0) { // server starts, try to find saved passes
    console.log(vault_num + " is vault_num");
    // http://stackoverflow.com/questions/4299991/how-to-sort-in-mongoose
    var query = PassesModel.find(null).sort({ vault_num : "desc"}).limit(1);
    // .limit(1) takes the most recent element of vault_num

    query.exec(function (err, comms) {
      if(err) {
        throw err;
      }
      if(comms.length != 0) { // mongo file is not empty, retrieving last pass
        console.log("Server restarted, retrieving the current pass");
        console.log("vault_num " + comms[0].vault_num);
        console.log("true_pass " + comms[0].pass);
        vault_num = comms[0].vault_num;
        true_pass = comms[0].pass;
        console.log('>>> Current secret pass: ' + true_pass + ' <<<');
      }
      else { // mongo file is empty, first launching time
        console.log("First launch, creating the new pass");
        add_new_vault();
      }
    });
  }
}

var add_new_vault = function() {
  vault_num++;
  true_pass =  Math.floor(10000*Math.random());
  //now, update the database passes

  //mongo connexion
  var add_pass = new PassesModel();
  add_pass.vault_num = vault_num;
  add_pass.pass = true_pass;

  add_pass.save(function (err) {
    if(err) {
      console.log("Failed to insert add_pass"); throw err;
    }
    console.log("Inserted add_pass ");
  });
  //mongo connexion end

  console.log('>>> New secret pass: ' + true_pass + ' <<<');
}

// function when a player found a pass
var new_vault_player = function(socket) {
  if(vault_num < 10000) {
    new_vault();
    socket.message = 'Vault ' + (vault_num-1) + ' is open... ' +
                      vault_num + ' is the new vault to holdup.';
    socket.broadcast.emit('send_html', {message: socket.message});
    // socket.emit('send_html', {message: socket.message});
  } 
  else {
    console.log('>>> End of the game <<<');
    true_pass = -1;
  }
}

// function when a player connects/disconnects
var player_send_html = function(socket) {
  console.log('Now ' + num_players + ' player(s).');
  if(num_players==1) {
    player_text = 'player';
  }
  else {
    player_text = 'players';
  }
  socket.message = num_players + ' ' + player_text +
                   ' online / Vault ' + vault_num + ".";
  socket.emit('send_html', {message: socket.message});
  socket.broadcast.emit('send_html', {message: socket.message});
}

// Server initialization
new_vault();

var app = express();

//app.use('/static', express.static(__dirname + '/public'));
app.use("/font", express.static(__dirname + '/font'));
app.use("/img", express.static(__dirname + '/img'));

app.get('/index.html', function(req, res) {
  fs.readFile('./index.html', 'utf-8', function(error, content) {
    res.writeHead(200, {"Content-Type": "text/html"});
    res.end(content);
  });
});

app.use(function(req, res, next){
  res.redirect('/index.html');
});

app.set('port', (process.env.PORT || 5000))

// http://stackoverflow.com/questions/17696801/express-js-app-listen-vs-server-listen
var server = app.listen(app.get('port'));

// Loading and using socket.io
var io = require('socket.io').listen(server);

// each socket is linked to a player
io.sockets.on('connection', function (socket) {
  num_players++
  player_send_html(socket);
  socket.ban = false;

  // id 
  socket.id_player = shortid.generate();

  // ip
  socket.ip_player = socket.handshake.headers['x-forwarded-for'];
  if (!socket.ip_player){
    socket.ip_player = socket.conn.remoteAddress;
  } 

  // Country
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
      //ent, then conversion to base 10 to prevent strange strings:
      socket.pass = parseInt(ent.encode(String(pass_to_test)), 10);
      if(socket.pass > -0.5 & socket.pass < 9999.5) {
        socket.newDate = Date.now()/1000; //date in seconds

        if(socket.ban == true) {
          socket.emit('lose');
        }
        else if(socket.newDate - socket.oldDate < 0.5) {
          // are you here only to read this feature?
          console.log('warning! Attempts are too close');
          socket.ban = true;
        }
        else {
          console.log('( date: ' + socket.newDate + 
                      ' / pass: ' + socket.pass +
                      ' / vault_num: ' + vault_num +
                      ' / id: ' + socket.id_player + 
                      ' / ip: ' + socket.ip_player +
                      ' / country: ' + socket.country + ')');

          //mongo connexion
          var attempt = new AttemptsModel();
          attempt.date = socket.newDate;
          attempt.id = socket.id_player;
          attempt.ip = socket.ip_player;
          attempt.country = socket.country;
          attempt.pass = socket.pass;
          attempt.vault_num = vault_num;

          attempt.save(function (err) {
            if(err) {
              console.log("Failed to insert attempt"); throw err;
            }
            console.log("Inserted attempt ");
          });
          //mongo connexion end

          socket.win_vault_num = 0;

          if(socket.pass == true_pass) {
            link = "chat.jpg";
            socket.emit('win', link);

            socket.win_vault_num = vault_num;
            new_vault_player(socket);
          }
          else {
            socket.emit('lose');
          }
         socket.oldDate = socket.newDate;
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
      if(nickname.length > 30) {
        nickname = nickname.substr(0, 30);
      }

      socket.nickname = ent.encode(nickname);         
      socket.message = 'The winner for the vault ' + socket.win_vault_num +
                       ' is... ' + socket.nickname + '.';

      //mongo connexion
      var win = new WinsModel();
      win.date = socket.newDate;
      win.id = socket.id_player;
      win.ip = socket.ip_player;
      win.country = socket.country;
      win.pass = socket.pass;
      win.vault_num = socket.win_vault_num;
      win.nickname = socket.nickname;

      win.save(function (err) {
        if(err) {
          console.log("Failed to insert wins"); throw err;
        }
        console.log("Inserted wins ");
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
    player_send_html(socket);
  });
});