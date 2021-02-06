const Discord = require("discord.js");
const fs = require("fs");
const ms = require("ms");

module.exports.run = async (bot, message, args) => {
  let warns = JSON.parse(fs.readFileSync("./warnings.json", "utf8"));
  let wUser =
    message.guild.member(message.mentions.users.first()) ||
    message.guild.members.get(args[0]);
  if (!warns[wUser.id])
    warns[wUser.id] = {
      warns: 0,
    };

  if (!message.member.hasPermission("MANAGE_MESSAGES"))
    return message.reply("You can't do that.");

  if (!wUser) return message.reply("Couldn't find them yo");
  let warnlevel = warns[wUser.id].warns;
  console.log(">>>>>", warns[wUser.id].warns);

  message.channel.send(
    new Discord.RichEmbed()
      .setDescription("Warning Information")
      .setColor("#c40000")
      .addField("Member", `<@${wUser.id}>`)
      .addField("Amount of Warns", warnlevel)
  );
};

module.exports.help = {
  name: "warnlevel",
};
