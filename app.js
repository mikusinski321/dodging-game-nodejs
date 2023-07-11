const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 2301 });
const cors = require('cors');
const express = require('express');
const bcrypt = require("bcryptjs")
const cookieParser = require("cookie-parser");
const sessions = require('express-session');
const { body, validationResult } = require('express-validator');

const app = express();
const PORT = 2302;

const path = require('path');
const oneDay = 1000 * 60 * 60 * 24;

app.use(cookieParser());
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/images', express.static('images'))

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

var mysql = require('mysql2');
var con = mysql.createConnection({
    host: "localhost",
    user: "user",
    password: "password",
    database: 'login'
});

con.connect(function (err) {
    if (err) throw err;
    console.log("Mysql Server connected!");
});

app.use(sessions({
    secret: "sesskey",
    saveUninitialized: true,
    cookie: { maxAge: oneDay },
    resave: false
}));

const registrationValidationRules = [
    body('nick').isLength({ min: 4 }).withMessage('Nick must be at least 4 characters long!'),
    body('email').isEmail().withMessage('Invalid email address!'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long!')
        .matches(/[A-Z]/)
        .withMessage('Password must contain at least one uppercase letter!')
        .matches(/[0-9]/)
        .withMessage('Password must contain at least one number!'),
    body('password-confirm').custom((value, { req }) => {

        if (value !== req.body.password) {
            throw new Error('Passwords do not match!');
        }
        return true;
    }),
];

var leaderboardData;
function getScores() {
    con.query('SELECT CASE WHEN scores.user_id IS NULL THEN scores.nick ELSE users.nick END AS nick, scores.score FROM scores LEFT JOIN users ON scores.user_id = users.id ORDER BY scores.score DESC LIMIT 10;', (err, results) => {
        if (err) throw err;
        leaderboardData = JSON.parse(JSON.stringify(results));
    });
};

var coinsData;
function getCoins() {
    con.query('SELECT nick, coins FROM users ORDER BY coins DESC LIMIT 10;', (err, results) => {
        if (err) throw err;
        coinsData = JSON.parse(JSON.stringify(results));
    });
};

var commentsData;
function getComments() {
    con.query('SELECT DATE_FORMAT(submit_time, "%H:%i:%s %d/%m/%Y") AS submit_time,comments.content,comments.nick,users.nick as user FROM comments LEFT JOIN users ON comments.user_id=users.id ORDER BY comments.submit_time DESC LIMIT 10;', (err, results) => {
        if (err) throw err;
        commentsData = JSON.parse(JSON.stringify(results));
    });
};

const gameStates = {};
const gameSessions = {};
app.use((req, res, next) => {
    if (!req.session.loggedin && !req.session.nick) {
        req.session.nick = 'Guest' + getRandomNumber(100000, 999999);
    };
    res.locals.nick = req.session.nick;
    res.locals.loggedin = req.session.loggedin;
    next();
});

app.all("/", (req, res) => {
    if (req.method === 'POST') {
        gameStates[req.session.nick] = {
            isLoggedIn: req.session.loggedin,
            canvasHeight: req.body.canvasHeight,
            canvasWidth: req.body.canvasWidth,
            xHeight: req.body.xHeight * 7 / 10,
            xWidth: req.body.xHeight * 7 / 30,
            x: req.body.canvasWidth / 2 - req.body.xHeight * 7 / 60,
            dx: 0,
            score: 0,
            coins: 0,
            objects: [],
            flag: false,
            sender: null,
            creator: null,
            speed: req.body.canvasHeight / 100
        };
    };
    return res.render('index');
});

app.get("/leaderboard", (req, res) => {
    getScores();
    getCoins();
    if (req.session.loggedin) {
        con.query('SELECT * FROM users where nick=? ORDER BY coins DESC limit 1;', [req.session.nick], function (error, results) {
            con.query('SELECT scores.* FROM scores INNER JOIN users ON users.id=scores.user_id where users.nick=? order by score desc limit 1', [req.session.nick], function (error, results2) {
                if (results.length == 0) var tempCoin = "You haven't played any games yet!";
                if (results2.length == 0) var tempScore = "You haven't played any games yet!";
                return res.render('leaderboard', { coins: tempCoin || results[0].coins, bestScore: tempScore || results2[0].score });
            });
        });
    } else {
        con.query('SELECT * FROM scores WHERE nick=? ORDER BY score desc LIMIT 1', [req.session.nick], function (error, results) {
            if (results.length == 0) var tempScore = "You haven't played any games yet!";
            return res.render('leaderboard', { coins: 'Create account to collect coins!', bestScore: tempScore || results[0].score });
        });
    };
});

app.all("/comments", (req, res) => {
    if (req.method === 'GET') {
        getComments();
        res.render('comments', { message: null });
    } else if (req.method === 'POST') {
        formattedDate = getDate();
        if (req.session.loggedin) {
            var id;
            con.query('SELECT id FROM users WHERE nick = ?', [req.session.nick], function (error, results) {
                if (error) throw error;
                id = results[0].id;
                con.query('INSERT INTO comments SET?', { user_id: id, content: req.body.content, submit_time: formattedDate }, (error, result) => {
                    if (error) throw error;
                    getComments();
                    return res.render('comments', { message: 'Comment placed properly!', nick: req.session.nick, success: true });
                });
            });
        } else {
            con.query('INSERT INTO comments SET?', { nick: req.session.nick, content: req.body.content, submit_time: formattedDate }, (error, result) => {
                if (error) throw error;
                getComments();
                return res.render('comments', { message: 'Comment placed properly!', nick: req.session.nick, success: true });
            });
        }
    } else {
        res.status(405).send('Method Not Allowed');
    };
});

app.all("/about", (req, res) => {
    res.render('about');
});

app.all("/manual", (req, res) => {
    res.render('manual');
});

app.get('/error', (req, res) => {
    res.render('error');
});

app.all("/login", (req, res) => {
    if (req.session.loggedin) {
        return res.redirect(`/error`);
    };
    if (req.method === 'GET') {
        res.render('login', { message: null });
    } else if (req.method === 'POST') {
        if (req.body.email && req.body.password) {
            con.query('SELECT * FROM users WHERE email = ?', [req.body.email], function (error, results) {
                if (error) throw error;
                if (results.length === 0) {
                    return res.render('login', { message: 'No user with entered email!', success: false });
                };
                if (Object.values(req.sessionStore.sessions).some(session => JSON.parse(session).nick === results[0].nick)) {
                    return res.render('login', { message: 'User is already logged in!', success: false });
                };
                bcrypt.compare(req.body.password, results[0].password, (error, result) => {
                    if (result) {
                        req.session.loggedin = true;
                        req.session.nick = results[0].nick;
                        res.redirect('/');
                    } else {
                        return res.render('login', { message: 'Incorrect Username and/or Password!', success: false });
                    };
                });
            });
        } else {
            return res.render('register', { message: 'No user with that email!', success: true });
        };
    } else {
        res.status(405).send('Method Not Allowed');
    };
});

app.all("/register", registrationValidationRules, (req, res) => {
    if (req.session.loggedin) {
        return res.redirect('/error');
    };
    if (req.method === 'GET') {
        return res.render('register', { message: null });
    } else if (req.method === 'POST') {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.render('register', { message: errors.array()[0].msg, success: false, formData: req.body });
        } else {
            con.query('SELECT email FROM users WHERE email = ?', [req.body.email], async (error, result) => {
                if (error) throw error;
                if (result.length > 0) {
                    return res.render('register', { message: 'Email already in use!', success: false });
                } else {
                    con.query('SELECT nick FROM users WHERE nick = ?', [req.session.nick], async (error, result) => {
                        if (error) throw error;
                        if (result.length > 0) {
                            return res.render('register', { message: 'Nick already in use!', success: false });
                        } else {
                            let hashedPassword = await bcrypt.hash(req.body.password, 8)
                            con.query('INSERT INTO users SET?', { nick: req.body.nick, email: req.body.email, password: hashedPassword, coins: 0 }, (error, result) => {
                                if (error) {
                                    console.log(error)
                                    return res.render('register', { message: 'Something went wrong!', success: false });
                                } else {
                                    return res.render('login', { message: 'Properly registrated. Now log in!', success: true });
                                };
                            });
                        };
                    });
                };
            });
        };
    } else {
        res.status(405).send('Method Not Allowed');
    };
});

app.get('/logout', (req, res) => {
    if (!req.session.loggedin) {
        return res.redirect('/error');
    };
    req.session.destroy();
    res.redirect('/');
});

app.get('/leaderboardData', (req, res) => {
    getScores();
    res.json(leaderboardData);
});

app.get('/coinsData', (req, res) => {
    getCoins();
    res.json(coinsData);
});

app.get('/commentsData', (req, res) => {
    getComments();
    res.json(commentsData);
});

app.listen(PORT, () => {
    console.log(`Running server on PORT ${PORT}...`);
});

wss.on('connection', (ws) => {
    console.log('Websocket Client connected');
    ws.on('message', (data) => {
        data = JSON.parse(data)
        if (data.type === 'nick') {
            ws.nick = data.nick;
            gameSessions[data.nick] = ws;
        } else {
            if (gameSessions[data.nick] && gameSessions[data.nick].readyState === WebSocket.OPEN) {
                if (data.keyCode == 32 && data.type == 'keyup' && gameStates[data.nick].flag == false) {
                    gameStates[data.nick].flag = true;
                    gameStates[data.nick].creator = setInterval(() => {
                        const object = createObject('obstacle', data.nick);
                        gameStates[data.nick].objects.push(object);
                    }, 1000 / 4);
                    if (gameStates[data.nick].isLoggedIn) {
                        gameStates[data.nick].coinCreator = setInterval(() => {
                            const object = createObject('coin', data.nick);
                            gameStates[data.nick].objects.push(object);
                        }, 1000 / 1);
                    };
                    gameStates[data.nick].sender = setInterval(() => {

                        gameStates[data.nick].x += gameStates[data.nick].dx;
                        if (gameStates[data.nick].x >= gameStates[data.nick].canvasWidth) {
                            gameStates[data.nick].x = gameStates[data.nick].canvasWidth;
                        } else if (gameStates[data.nick].x <= 0) {
                            gameStates[data.nick].x = 0;
                        };
                        gameStates[data.nick].objects.forEach((el) => { el.y += gameStates[data.nick].speed; })

                        var coins;
                        coins = gameStates[data.nick].objects.filter(function (obj) {
                            return obj.type === 'coin';
                        });
                        coins = coins.filter(function (el) { return el.y < gameStates[data.nick].canvasHeight; });

                        var obstacles;
                        obstacles = gameStates[data.nick].objects.filter(function (obj) {
                            return obj.type === 'obstacle';
                        });

                        var temp = obstacles.length;
                        obstacles = obstacles.filter(function (el) { return el.y < gameStates[data.nick].canvasHeight; });
                        temp = temp - obstacles.length;
                        gameStates[data.nick].score += temp;

                        gameStates[data.nick].objects = gameStates[data.nick].objects.filter((item) => obstacles.includes(item));
                        gameStates[data.nick].objects = gameStates[data.nick].objects.concat(coins);

                        var playerY = gameStates[data.nick].canvasHeight - gameStates[data.nick].canvasHeight / 5;
                        for (var i = 0; i < gameStates[data.nick].objects.length; i++) {
                            if (gameStates[data.nick].x < gameStates[data.nick].objects[i].x + gameStates[data.nick].objects[i].width &&
                                gameStates[data.nick].x + gameStates[data.nick].xWidth > gameStates[data.nick].objects[i].x &&
                                playerY < gameStates[data.nick].objects[i].y + gameStates[data.nick].objects[i].height &&
                                playerY + gameStates[data.nick].xHeight > gameStates[data.nick].objects[i].y) {
                                if (gameStates[data.nick].objects[i].type == 'coin') {
                                    gameStates[data.nick].coins += 1;
                                    gameStates[data.nick].objects = gameStates[data.nick].objects.filter((element) => element !== gameStates[data.nick].objects[i]);
                                } else {
                                    clearInterval(gameStates[data.nick].sender);
                                    formattedDate = getDate();
                                    if (gameStates[data.nick].isLoggedIn) {
                                        var id;
                                        con.query('SELECT id FROM users WHERE nick = ?', [data.nick], function (error, results) {
                                            if (error) throw error;
                                            id = results[0].id;
                                            con.query('INSERT INTO scores(user_id,score,acquisition_time) VALUES (?,?,?)', [id, gameStates[data.nick].score, formattedDate], function (err, result) {
                                                if (err) throw err;
                                                else {
                                                    con.query('UPDATE users SET coins = coins + ? WHERE nick = ?', [gameStates[data.nick].coins, data.nick], function (err, result) {
                                                        if (err) throw err;
                                                        else reset(data.nick);
                                                    });
                                                };
                                            });
                                        });
                                    } else {
                                        con.query('INSERT INTO scores(score,acquisition_time,nick) VALUES (?,?,?)', [gameStates[data.nick].score, formattedDate, data.nick], function (err, result) {
                                            if (err) throw err;
                                            else reset(data.nick);
                                        });
                                    };
                                };
                            };
                        };
                        gameStates[data.nick].speed+=0.001;
                        gameSessions[data.nick].send(JSON.stringify({ type: 'data', objectData: gameStates[data.nick].objects, xData: gameStates[data.nick].x, score: gameStates[data.nick].score, speed: gameStates[data.nick].speed }));
                    }, 1000 / 60);
                } else if (data.keyCode == 32 && data.type == 'keyup' && gameStates[data.nick].flag == true) {
                    if (gameStates[data.nick].isLoggedIn) clearInterval(gameStates[data.nick].coinCreator);
                    clearInterval(gameStates[data.nick].creator);
                    clearInterval(gameStates[data.nick].sender);
                    gameStates[data.nick].flag = false;
                    gameSessions[data.nick].send(JSON.stringify({ type: 'gamePaused' }));
                };
                if (data.type == 'keyup') {
                    handleKeyUp(data);
                } else if (data.type == 'keydown') {
                    handleKeyDown(data);
                };
            };
        };
    });

    ws.on('close', () => {
        if (gameStates[ws.nick]) {
            if (gameStates[ws.nick].isLoggedIn) clearInterval(gameStates[ws.nick].coinCreator);
            clearInterval(gameStates[ws.nick].creator);
            clearInterval(gameStates[ws.nick].sender);
            delete gameSessions[ws.nick];
            delete gameStates[ws.nick];
        };
        console.log('Websocket Client disconnected with ID:', ws.nick);
        delete sessions[ws.nick];
    });
});

function getDate() {
    const currentDate = new Date();
    const options = { timeZone: 'Europe/Warsaw', hour12: false };
    const formattedDate = currentDate.toLocaleString('en-US', options)
        .replace(/,/g, '')
        .replace(/(\d+)\/(\d+)\/(\d+)/, '$3-$1-$2')
        .replace(/\//g, '-');
    return formattedDate;
};

function reset(nick) {
    if (gameStates[nick].isLoggedIn) clearInterval(gameStates[nick].coinCreator);
    clearInterval(gameStates[nick].creator);
    clearInterval(gameStates[nick].sender);
    gameStates[nick].x = gameStates[nick].canvasWidth / 2;
    gameStates[nick].dx = 0;
    gameStates[nick].flag = false;
    gameStates[nick].objects = [];
    gameStates[nick].speed = gameStates[nick].canvasHeight / 90;
    gameSessions[nick].send(JSON.stringify({ type: 'gameOver', score: gameStates[nick].score }));
    gameStates[nick].score = 0;
};

function handleKeyDown(data) {
    switch (data.keyCode) {
        case 37:
            gameStates[data.nick].dx = -(gameStates[data.nick].canvasWidth / 50);
            break;
        case 39:
            gameStates[data.nick].dx = gameStates[data.nick].canvasWidth / 50;
            break;
    };
};

function handleKeyUp(data) {
    switch (data.keyCode) {
        case 37:
            gameStates[data.nick].dx = 0;
            break;
        case 39:
            gameStates[data.nick].dx = 0;
            break;
    };
};

function createObject(type, nick) {
    if (type == 'coin') {
        return {
            x: getRandomNumber(0, gameStates[nick].canvasWidth),
            y: -100,
            width: gameStates[nick].canvasWidth / 19,
            height: gameStates[nick].canvasHeight / 15,
            type: type
        };
    } else {
        return {
            x: getRandomNumber(0, gameStates[nick].canvasWidth),
            y: -100,
            width: getRandomNumber(gameStates[nick].canvasWidth / 17, gameStates[nick].canvasWidth / 7),
            height: getRandomNumber(gameStates[nick].canvasHeight / 17, gameStates[nick].canvasHeight / 7),
            type: type
        };
    };
};

function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

