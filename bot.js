"use strict";

const Discord = require("discord.js");
const fs = require("fs");
// const fetch = require('node-fetch');
const fetchTimeout = require("fetch-timeout");
const { paddedFullWidth, errorWrap } = require("./utils.js");

if (Discord.version.startsWith("12.")) {
  // rename functions for compatibilities sake while testing
  Discord.RichEmbed = Discord.MessageEmbed;
  Discord.TextChannel.prototype.fetchMessage = function (snowflake) {
    // not perfect but whatevs
    return this.messages.fetch.apply(this.messages, [snowflake]);
    // return new Promise((resolve,reject) => {
    //   let message = this.messages.fetch(snowflake);
    //   if (message === undefined) reject(notfound);
    //   else resolve(message);
    // })
  };
  Object.defineProperty(Discord.User.prototype, "displayAvatarURL", {
    get: function () {
      return this.avatarURL();
    },
  });
  // Object.defineProperty(Discord.GuildMember.prototype,'voiceChannelID',{
  //   'get': function() {
  //     if (this.voiceStates.size > 0) {
  //       var channelID;
  //       for (let id in this.voiceStates) {
  //         channelID =  this.voiceStates[id].channel.id;
  //         console.log(this.voiceStates[id].channel);
  //       }
  //       return channelID;
  //     }
  //     return undefined;
  //   }
  // })
}

const LOG_LEVELS = {
  ERROR: 3,
  INFO: 2,
  DEBUG: 1,
  SPAM: 0,
};

const BOT_CONFIG = {
  apiRequestMethod: "sequential",
  messageCacheMaxSize: 50,
  messageCacheLifetime: 0,
  messageSweepInterval: 0,
  fetchAllMembers: false,
  disableEveryone: true,
  sync: false,
  restWsBridgeTimeout: 5000, // check these
  restTimeOffset: 300,
  disabledEvents: ["CHANNEL_PINS_UPDATE", "TYPING_START"],
  ws: {
    large_threshold: 100,
    compress: true,
  },
};

const USER_AGENT = `bot ${require("./package.json").version} , Node ${
  process.version
} (${process.platform}${process.arch})`;

exports.start = function (SETUP) {
  const URL_SERVER = SETUP.URL_SERVER;

  const URL_PLAYERS = new URL("/players.json", SETUP.URL_SERVER).toString();
  const URL_INFO = new URL("/info.json", SETUP.URL_SERVER).toString();
  const MAX_PLAYERS = 64;
  const TICK_MAX = 1 << 9; // max bits for TICK_N
  const FETCH_TIMEOUT = 900;
  const FETCH_OPS = {
    cache: "no-cache",
    method: "GET",
    headers: { "User-Agent": USER_AGENT },
  };

  const LOG_LEVEL =
    SETUP.LOG_LEVEL !== undefined ? parseInt(SETUP.LOG_LEVEL) : LOG_LEVELS.INFO;
  const CHANNEL_ID = SETUP.CHANNEL_ID;
  const MESSAGE_ID = SETUP.MESSAGE_ID;
  const SUGGESTION_CHANNEL = SETUP.SUGGESTION_CHANNEL;
  const BUG_CHANNEL = SETUP.BUG_CHANNEL;
  const BUG_LOG_CHANNEL = SETUP.BUG_LOG_CHANNEL;
  const LOG_CHANNEL = SETUP.LOG_CHANNEL;
  const STREAM_URL = SETUP.STREAM_URL;
  const SERVER_NAME = SETUP.SERVER_NAME;
  const STREAM_CHANNEL = SETUP.STREAM_CHANNEL;
  const prefix = SETUP.PREFIX;
  const UPDATE_TIME = 2500; // in ms

  var TICK_N = 0;
  var MESSAGE;
  var LAST_COUNT;
  var STATUS;

  var STREAM_DISPATCHER = undefined;

  var loop_callbacks = []; // for testing whether loop is still running

  const log = function (level, message) {
    if (level >= LOG_LEVEL)
      console.log(`${new Date().toLocaleString()} :${level}: ${message}`);
  };

  const getPlayers = function () {
    return new Promise((resolve, reject) => {
      fetchTimeout(URL_PLAYERS, FETCH_OPS, FETCH_TIMEOUT)
        .then((res) => {
          res
            .json()
            .then((players) => {
              resolve(players);
            })
            .catch(reject);
        })
        .catch(reject);
    });
  };

  const getVars = function () {
    return new Promise((resolve, reject) => {
      fetchTimeout(URL_INFO, FETCH_OPS, FETCH_TIMEOUT)
        .then((res) => {
          res
            .json()
            .then((info) => {
              resolve(info.vars);
            })
            .catch(reject);
        })
        .catch(reject);
    });
  };

  const bot = new Discord.Client(BOT_CONFIG);
  bot.commands = new Discord.Collection();
  fs.readdir("./commands/", (err, files) => {
    if (err) console.log(err);

    let jsfile = files.filter((f) => f.split(".").pop() === "js");
    if (jsfile.length <= 0) {
      console.log("Couldn't find commands.");
      return;
    }
    jsfile.forEach((f, i) => {
      let props = require(`./commands/${f}`);
      console.log(`${f} loaded`);
      bot.commands.set(props.help.name, props);
    });
  });

  bot.on("message", async (message) => {
    let messageArray = message.content.split(" ");
    let cmd = messageArray[0];
    let args = messageArray.slice(1);
    if (message.content.startsWith(prefix)) {
      let commandFile = bot.commands.get(cmd.slice(prefix.length));
      if (commandFile) commandFile.run(bot, message, args);
    }
  });

  const sendOrUpdate = function (embed) {
    if (MESSAGE !== undefined) {
      MESSAGE.edit(embed)
        .then(() => {
          log(LOG_LEVELS.DEBUG, "Update success");
        })
        .catch(() => {
          log(LOG_LEVELS.ERROR, "Update failed");
        });
    } else {
      let channel = bot.channels.get(CHANNEL_ID);
      if (channel !== undefined) {
        channel
          .fetchMessage(MESSAGE_ID)
          .then((message) => {
            MESSAGE = message;
            message
              .edit(embed)
              .then(() => {
                log(LOG_LEVELS.SPAM, "Update success");
              })
              .catch(() => {
                log(LOG_LEVELS.ERROR, "Update failed");
              });
          })
          .catch(() => {
            channel
              .send(embed)
              .then((message) => {
                MESSAGE = message;
                log(LOG_LEVELS.INFO, `Sent message (${message.id})`);
              })
              .catch(console.error);
          });
      } else {
        log(LOG_LEVELS.ERROR, "Update channel not set");
      }
    }
  };

  const UpdateEmbed = function () {
    let dot = TICK_N % 2 === 0 ? `${SERVER_NAME}` : "Roleplay";
    let embed = new Discord.RichEmbed()
      .setAuthor(`${SERVER_NAME} Status`, "https://i.imgur.com/cfbSJm1.png")
      .setColor(0x2894c2)
      .setFooter(TICK_N % 2 === 0 ? `⚪ ${SERVER_NAME}` : `⚫ ${SERVER_NAME}`)
      .setTimestamp(new Date())
      .addField(
        "\n\u200b\nCum vă puteți alătura serverului?\u200b",
        "Vă puteți alătura serverului scriind connect ***cfx.re/join/9or6mm*** in consola F8 din FiveM. În partea de jos este statusul serverului pentru a vedea câte persoane sunt online și în coadă.\n\u200b\n"
      );
    if (STATUS !== undefined) {
      embed.addField(":warning: Status do servidor:", `${STATUS}\n\u200b\n`);
      embed.setColor(0xff5d00);
    }
    return embed;
  };

  const offline = function () {
    log(LOG_LEVELS.SPAM, Array.from(arguments));
    log(LAST_COUNT)
    if (LAST_COUNT !== null)
      log(
        LOG_LEVELS.INFO,
        `Server offline ${URL_SERVER} (${URL_PLAYERS} ${URL_INFO})`
      );
    let embed = UpdateEmbed()
      .setColor(0xff0000)
      .addField("Server Status", ":x: Offline", true)
      .addField("Coada", "?", true)
      .addField("Jucatori Online", "?\n\u200b\n", true);
    sendOrUpdate(embed);
    LAST_COUNT = null;
  };

  // bot.on("guildMemberAdd", (member) => {
  //   const channel = member.guild.channels.find(
  //     (channel) => channel.name === "geral"
  //   );
  //   if (!channel) return;

  //   channel.send(`Welcome to our server, ${member}, please read the rules`);
  // });

  bot.on("message", (message) => {
    //whenever a message is sent
    if (
      message.content.includes("discord.gg/") ||
      message.content.includes("discordapp.com/invite/") ||
      message.content.includes("discord.me/")
    ) {
      if (!message.member.hasPermission("MANAGE_MESSAGES")) {
        const Author = message.member.user.tag;
        message
          .delete() //delete the message
          .then(
            message.channel.send({
              embed: {
                title: `Link-ul de Discord trimis de ${Author} a fost sters`,
                color: 16711680,
                description: "Nu este permis sa faci asta!",
              },
            })
          );
      }
    }
  });

  const updateMessage = function () {
    getVars()
      .then((vars) => {
        getPlayers()
          .then((players) => {
            if (players.length !== LAST_COUNT)
              log(LOG_LEVELS.INFO, `${players.length} players`);
            let queue = vars["Queue"];
            let embed = UpdateEmbed()
              .addField("Server Status", ":white_check_mark: Online", true)
              .addField(
                "Coada",
                queue === "Enabled" || queue === undefined
                  ? "0"
                  : queue.split(":")[1].trim(),
                true
              )
              .addField(
                "Jucatori Online",
                `${players.length}/${MAX_PLAYERS}\n\u200b\n`,
                true
              );
            // .addField('\u200b','\u200b\n\u200b\n',true);
            if (players.length > 0) {
              // method D
              const fieldCount = 3;
              const fields = new Array(fieldCount);
              fields.fill("");
              // for (var i=0;i<players.length;i++) {
              //   fields[i%4 >= 2 ? 1 : 0] += `${players[i].name}${i % 2 === 0 ? '\u200e' : '\n\u200f'}`;
              // }
              fields[0] = `**Jucatori conectati:**\n`;
              for (var i = 0; i < players.length; i++) {
                fields[(i + 1) % fieldCount] += `${players[i].name.substr(
                  0,
                  12
                )}\n`; // first 12 characters of players name
              }
              for (var i = 0; i < fields.length; i++) {
                let field = fields[i];
                if (field.length > 0) embed.addField("\u200b", field, true);
              }
            }
            sendOrUpdate(embed);
            LAST_COUNT = players.length;
          })
          .catch(offline);
      })
      .catch(offline);
    TICK_N++;
    if (TICK_N >= TICK_MAX) {
      TICK_N = 0;
    }
    for (var i = 0; i < loop_callbacks.length; i++) {
      let callback = loop_callbacks.pop(0);
      callback();
    }
  };

  bot.on("ready", () => {
    log(LOG_LEVELS.INFO, "Started...");
    bot.user.setActivity("FreeDOM Romania", {
      url: "https://discord.io/FreeDOM_HRP",
      type: "PLAYING",
    });
    bot
      .generateInvite(["ADMINISTRATOR"])
      .then((link) => {
        log(LOG_LEVELS.INFO, `Invite URL - ${link}`);
      })
      .catch(null);
    bot.setInterval(updateMessage, UPDATE_TIME);
  });

  function checkLoop() {
    return new Promise((resolve, reject) => {
      var resolved = false;
      let id = loop_callbacks.push(() => {
        if (!resolved) {
          resolved = true;
          resolve(true);
        } else {
          log(LOG_LEVELS.ERROR, "Loop callback called after timeout");
          reject(null);
        }
      });
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      }, 3000);
    });
  }

  bot.on("debug", (info) => {
    log(LOG_LEVELS.SPAM, info);
  });

  bot.on("error", (error, shard) => {
    log(LOG_LEVELS.ERROR, error);
  });

  bot.on("warn", (info) => {
    log(LOG_LEVELS.DEBUG, info);
  });

  bot.on("disconnect", (devent, shard) => {
    log(LOG_LEVELS.INFO, "Disconnected");
    checkLoop()
      .then((running) => {
        log(LOG_LEVELS.INFO, `Loop still running: ${running}`);
      })
      .catch(console.error);
  });

  bot.on("reconnecting", (shard) => {
    log(LOG_LEVELS.INFO, "Reconnecting");
    checkLoop()
      .then((running) => {
        log(LOG_LEVELS.INFO, `Loop still running: ${running}`);
      })
      .catch(console.error);
  });

  bot.on("resume", (replayed, shard) => {
    log(LOG_LEVELS.INFO, `Resuming (${replayed} events replayed)`);
    checkLoop()
      .then((running) => {
        log(LOG_LEVELS.INFO, `Loop still running: ${running}`);
      })
      .catch(console.error);
  });

  bot.on("rateLimit", (info) => {
    log(
      LOG_LEVELS.INFO,
      `Rate limit hit ${
        info.timeDifference
          ? info.timeDifference
          : info.timeout
          ? info.timeout
          : "Unknown timeout "
      }ms (${info.path} / ${
        info.requestLimit
          ? info.requestLimit
          : info.limit
          ? info.limit
          : "Unkown limit"
      })`
    );
    if (
      info.path.startsWith(
        `/channels/${CHANNEL_ID}/messages/${
          MESSAGE_ID ? MESSAGE_ID : MESSAGE ? MESSAGE.id : ""
        }`
      )
    )
      bot.emit("restart");
    checkLoop()
      .then((running) => {
        log(LOG_LEVELS.DEBUG, `Loop still running: ${running}`);
      })
      .catch(console.error);
  });

  bot.on("message", async function (msg) {
    if (msg.channel.id === "586631869928308743") {
      await msg.react(bot.emojis.get("587057796936368128"));
      await msg.react(bot.emojis.get("595353996626231326"));
    }
  });

  bot.on("message", (message) => {
    if (!message.author.bot) {
      if (message.member) {
        if (message.member.hasPermission("ADMINISTRATOR")) {
          if (message.content.startsWith("+status ")) {
            let status = message.content.substr(7).trim();
            let embed = new Discord.RichEmbed()
              .setAuthor(
                message.member.nickname
                  ? message.member.nickname
                  : message.author.tag,
                message.author.displayAvatarURL
              )
              .setColor(0x2894c2)
              .setTitle("Updated status message")
              .setTimestamp(new Date());
            if (status === "clear") {
              STATUS = undefined;
              embed.setDescription("Cleared status message");
            } else {
              STATUS = status;
              embed.setDescription(`New message:\n\`\`\`${STATUS}\`\`\``);
            }
            bot.channels.get(LOG_CHANNEL).send(embed);
            return log(
              LOG_LEVELS.INFO,
              `${message.author.username} updated status`
            );
          }
        }
        if (message.channel.id === SUGGESTION_CHANNEL) {
          let embed = new Discord.RichEmbed()
            .setAuthor(
              message.member.nickname
                ? message.member.nickname
                : message.author.tag,
              message.author.displayAvatarURL
            )
            .setColor(0x2894c2)
            .setTitle("Sugestie")
            .setDescription(message.content)
            .setTimestamp(new Date());
          message.channel
            .send(embed)
            .then((message) => {
              const sent = message;
              sent
                .react("⬆️")
                .then(() => {
                  sent
                    .react("⬇️")
                    .then(() => {
                      log(LOG_LEVELS.SPAM, "Completed suggestion message");
                    })
                    .catch(console.error);
                })
                .catch(console.error);
            })
            .catch(console.error);
          return message.delete();
        }
        if (message.channel.id === BUG_CHANNEL) {
          let embedUser = new Discord.RichEmbed()
            .setAuthor(
              message.member.nickname
                ? message.member.nickname
                : message.author.tag,
              message.author.displayAvatarURL
            )
            .setColor(0x2894c2)
            .setTitle("Raport Bug")
            .setDescription(
              "Raportul dvs. a fost trimis cu succes echipei STAFF!"
            )
            .setTimestamp(new Date());
          let embedStaff = new Discord.RichEmbed()
            .setAuthor(
              message.member.nickname
                ? message.member.nickname
                : message.author.tag,
              message.author.displayAvatarURL
            )
            .setColor(0x2894c2)
            .setTitle("Raport Bug")
            .setDescription(message.content)
            .setTimestamp(new Date());
          message.channel.send(embedUser).then(null).catch(console.error);
          bot.channels
            .get(BUG_LOG_CHANNEL)
            .send(embedStaff)
            .then(null)
            .catch(console.error);
          return message.delete();
        }
      }
    }
  });

  bot
    .login(process.env.token)
    .then(null)
    .catch(() => {
      log(LOG_LEVELS.ERROR, "Unable to login check your login token");
      console.error(e);
      process.exit(1);
    });

  return bot;
};
