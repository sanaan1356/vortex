require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ActivityType
} = require("discord.js");

// ==========================================
// VORTEX CONFIG
// ==========================================

const PREFIX = "c!";
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");

const STAFF_ROLES = [
  "1543659012921237555", // Leader of Staff
  "1549070828954456134", // Head Admin
  "1543658230557708319", // Admin
  "1546166364555976795", // Head Mod
  "1543658446954569829", // Mod
  "1543658722671202506", // TMOD
  "1543657449200943214"  // Staff
];

const STAFF_ANNOUNCEMENT_CHANNEL = "1543654452978778162";

// Set DASHBOARD_PASSWORD in Railway Variables before using the dashboard.
// The dashboard will stay locked if this variable is missing.

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ==========================================
// DATA STORAGE
// ==========================================

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  } catch (error) {
    console.error("Could not read data.json:", error);
  }

  return {
    warnings: {},
    modlogs: {},
    dailyCounts: {},
    giveaways: {}
  };
}

const data = loadData();

data.warnings ||= {};
data.modlogs ||= {};
data.dailyCounts ||= {};
data.giveaways ||= {};

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Could not save data.json:", error);
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getDailyCount(userId) {
  const today = todayKey();
  return data.dailyCounts[userId]?.[today] || 0;
}

function addModLog(guildId, userId, action, moderatorId, reason) {
  const key = `${guildId}:${userId}`;

  if (!data.modlogs[key]) data.modlogs[key] = [];

  data.modlogs[key].push({
    action,
    moderatorId,
    reason: reason || "No reason provided",
    timestamp: Date.now()
  });

  if (data.modlogs[key].length > 100) {
    data.modlogs[key] = data.modlogs[key].slice(-100);
  }

  saveData();
}

function hasStaffRole(member) {
  if (!member) return false;

  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    STAFF_ROLES.some(roleId => member.roles.cache.has(roleId))
  );
}

function canModerate(member) {
  return Boolean(
    member &&
    (
      member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
      member.permissions.has(PermissionFlagsBits.Administrator)
    )
  );
}

function getTargetId(text) {
  if (!text) return null;
  return text.replace(/[<@!>]/g, "");
}

function parseDuration(text) {
  if (!text) return null;

  const match = text.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multiplier = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const result = amount * multiplier[unit];

  if (!Number.isFinite(result) || result <= 0) return null;
  return result;
}

function formatDuration(ms) {
  const units = [
    ["d", 86400000],
    ["h", 3600000],
    ["m", 60000],
    ["s", 1000]
  ];

  for (const [label, value] of units) {
    if (ms >= value) {
      return `${Math.floor(ms / value)}${label}`;
    }
  }

  return "less than 1 second";
}

function safeText(text, max = 1000) {
  return String(text || "No reason provided").slice(0, max);
}

// ==========================================
// GIVEAWAY HELPERS
// ==========================================

function normalizeGiveaway(giveaway) {
  giveaway.entries ||= {};
  giveaway.requiredRoleIds ||= [];
  giveaway.bonusRoleId ||= null;
  giveaway.extraEntries ||= 0;
  giveaway.bypassRoleId ||= null;
  giveaway.ended ||= false;
  giveaway.claimed ||= [];
  giveaway.winners ||= [];
  giveaway.messageId ||= null;
  giveaway.channelId ||= null;
  giveaway.guildId ||= null;
  giveaway.hostId ||= null;

  return giveaway;
}

function getGiveaway(messageId) {
  const giveaway = data.giveaways[messageId];
  return giveaway ? normalizeGiveaway(giveaway) : null;
}

function participantCount(giveaway) {
  return Object.keys(giveaway.entries || {}).length;
}

function getRemainingText(giveaway) {
  if (giveaway.ended) return "Ended";

  const remaining = giveaway.endAt - Date.now();
  if (remaining <= 0) return "Ending soon";

  const days = Math.floor(remaining / 86400000);
  const hours = Math.floor((remaining % 86400000) / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function buildGiveawayEmbed(giveaway) {
  const embed = new EmbedBuilder()
    .setColor(giveaway.ended ? 0x747f8d : 0x7c3aed)
    .setTitle(`🎉 ${giveaway.prize}`)
    .setDescription(
      [
        `**Host:** <@${giveaway.hostId}>`,
        `**Winners:** ${giveaway.winnerCount}`,
        `**Participants:** ${participantCount(giveaway)}`,
        `**Time remaining:** ${getRemainingText(giveaway)}`,
        "",
        giveaway.requiredRoleIds.length
          ? `**Required role(s):** ${giveaway.requiredRoleIds.map(id => `<@&${id}>`).join(", ")}`
          : "**Required role(s):** None",
        giveaway.dailyMessages > 0
          ? `**Daily message requirement:** ${giveaway.dailyMessages} messages`
          : "**Daily message requirement:** None",
        giveaway.bonusRoleId
          ? `**Extra entries:** <@&${giveaway.bonusRoleId}> gets ${giveaway.extraEntries} extra entries`
          : "**Extra entries:** None",
        giveaway.bypassRoleId
          ? `**Requirement bypass:** <@&${giveaway.bypassRoleId}>`
          : "**Requirement bypass:** None",
        giveaway.claimTime > 0
          ? `**Claim time:** ${formatDuration(giveaway.claimTime)}`
          : "**Claim time:** Not enabled",
        giveaway.ended ? "\n**GIVEAWAY ENDED**" : ""
      ].filter(Boolean).join("\n")
    )
    .setFooter({ text: "VORTEX Giveaways" })
    .setTimestamp(new Date(giveaway.endAt));

  if (giveaway.image) embed.setImage(giveaway.image);

  if (giveaway.winners.length > 0) {
    embed.addFields({
      name: "Winner(s)",
      value: giveaway.winners.map(id => `<@${id}>`).join(", ").slice(0, 1024)
    });
  }

  return embed;
}

function makeEntryRow(messageId, ended = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vortex_enter:${messageId}`)
      .setLabel(ended ? "Giveaway Ended" : "Enter Giveaway")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Success)
      .setDisabled(ended),
    new ButtonBuilder()
      .setCustomId(`vortex_participants:${messageId}`)
      .setLabel("Participants")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary)
  );
}

function makeClaimRow(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vortex_claim:${messageId}`)
      .setLabel("Claim Prize")
      .setEmoji("🎁")
      .setStyle(ButtonStyle.Success)
  );
}

function makeRemovalMenu(giveaway, page = 0) {
  const entries = Object.entries(giveaway.entries);
  const start = page * 25;
  const pageEntries = entries.slice(start, start + 25);

  if (!pageEntries.length) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`vortex_remove:${giveaway.messageId}`)
    .setPlaceholder("Select a participant to remove")
    .setMinValues(1)
    .setMaxValues(Math.min(pageEntries.length, 25))
    .addOptions(
      pageEntries.map(([userId, entry]) => ({
        label: `User ${userId}`.slice(0, 100),
        description: `${entry.entries || 1} weighted entr${(entry.entries || 1) === 1 ? "y" : "ies"}`,
        value: userId
      }))
    );

  return new ActionRowBuilder().addComponents(menu);
}

function hasGiveawayRequirements(member, giveaway) {
  if (!member) return false;

  if (
    giveaway.bypassRoleId &&
    member.roles.cache.has(giveaway.bypassRoleId)
  ) {
    return true;
  }

  const hasAllRequiredRoles = giveaway.requiredRoleIds.every(roleId =>
    member.roles.cache.has(roleId)
  );

  const hasEnoughMessages =
    giveaway.dailyMessages <= 0 ||
    getDailyCount(member.id) >= giveaway.dailyMessages;

  return hasAllRequiredRoles && hasEnoughMessages;
}

function getWeightedEntries(giveaway) {
  const weighted = [];

  for (const [userId, entry] of Object.entries(giveaway.entries)) {
    const count = Math.max(1, Number(entry.entries) || 1);

    for (let i = 0; i < count; i++) {
      weighted.push(userId);
    }
  }

  return weighted;
}

function pickWinners(giveaway, amount) {
  const weighted = getWeightedEntries(giveaway);
  const selected = new Set();

  while (selected.size < amount && weighted.length > 0) {
    const index = Math.floor(Math.random() * weighted.length);
    selected.add(weighted[index]);
    weighted.splice(index, 1);
  }

  return [...selected];
}

async function updateGiveawayMessage(giveaway) {
  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(giveaway.messageId);

    await message.edit({
      embeds: [buildGiveawayEmbed(giveaway)],
      components: [makeEntryRow(giveaway.messageId, giveaway.ended)]
    });
  } catch (error) {
    console.error("Could not update giveaway message:", error.message);
  }
}

async function finishGiveaway(giveaway, forced = false) {
  if (!giveaway || giveaway.ended) return;

  if (!forced && giveaway.endAt > Date.now()) return;

  giveaway.ended = true;
  giveaway.winners = pickWinners(giveaway, giveaway.winnerCount);
  saveData();

  await updateGiveawayMessage(giveaway);

  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (!channel || !channel.isTextBased()) return;

    if (giveaway.winners.length === 0) {
      await channel.send(`🎉 Giveaway **${giveaway.prize}** ended with no eligible participants.`);
      return;
    }

    const winnerText = giveaway.winners.map(id => `<@${id}>`).join(", ");

    if (giveaway.claimTime > 0) {
      giveaway.claimDeadline = Date.now() + giveaway.claimTime;
      saveData();

      await channel.send({
        content:
          `🎉 Congratulations ${winnerText}! You won **${giveaway.prize}**.\n` +
          `Click **Claim Prize** within ${formatDuration(giveaway.claimTime)}.`,
        components: [makeClaimRow(giveaway.messageId)]
      });
    } else {
      await channel.send(
        `🎉 Congratulations ${winnerText}! You won **${giveaway.prize}**!`
      );
    }
  } catch (error) {
    console.error("Could not announce giveaway winner:", error.message);
  }
}

async function checkGiveaways() {
  for (const giveaway of Object.values(data.giveaways)) {
    normalizeGiveaway(giveaway);

    if (!giveaway.ended && giveaway.endAt <= Date.now()) {
      await finishGiveaway(giveaway);
    }

    if (
      giveaway.ended &&
      giveaway.claimDeadline &&
      giveaway.claimDeadline <= Date.now()
    ) {
      const unclaimed = giveaway.winners.filter(
        id => !giveaway.claimed.includes(id)
      );

      if (unclaimed.length > 0 && giveaway.replacementSelected !== true) {
        giveaway.replacementSelected = true;

        const excluded = new Set(giveaway.winners);
        const candidates = getWeightedEntries(giveaway).filter(
          id => !excluded.has(id)
        );

        const replacements = [];

        while (replacements.length < unclaimed.length && candidates.length > 0) {
          const index = Math.floor(Math.random() * candidates.length);
          replacements.push(candidates.splice(index, 1)[0]);
        }

        if (replacements.length > 0) {
          giveaway.winners = giveaway.winners.filter(
            id => giveaway.claimed.includes(id)
          ).concat(replacements);

          const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);

          if (channel && channel.isTextBased()) {
            await channel.send(
              `🔁 Replacement winner(s) for **${giveaway.prize}**: ` +
              replacements.map(id => `<@${id}>`).join(", ")
            );
          }
        }

        saveData();
      }
    }
  }
}

// ==========================================
// SLASH COMMANDS
// ==========================================

const giveawayCommand = new SlashCommandBuilder()
  .setName("giveaway")
  .setDescription("Manage VORTEX giveaways")
  .addSubcommand(sub =>
    sub.setName("start")
      .setDescription("Start a giveaway")
      .addStringOption(option =>
        option.setName("prize").setDescription("Prize").setRequired(true)
      )
      .addStringOption(option =>
        option.setName("duration").setDescription("Example: 10m, 2h, 1d").setRequired(true)
      )
      .addIntegerOption(option =>
        option.setName("winners").setDescription("Number of winners").setMinValue(1).setMaxValue(20).setRequired(true)
      )
      .addChannelOption(option =>
        option.setName("channel").setDescription("Giveaway channel").addChannelTypes(ChannelType.GuildText).setRequired(true)
      )
      .addStringOption(option =>
        option.setName("image").setDescription("Optional image URL").setRequired(false)
      )
      .addStringOption(option =>
        option.setName("claim_time").setDescription("Time to claim, e.g. 10m or 1h").setRequired(false)
      )
      .addIntegerOption(option =>
        option.setName("daily_messages").setDescription("Messages required today").setMinValue(0).setMaxValue(1000).setRequired(false)
      )
      .addRoleOption(option =>
        option.setName("bypass_role").setDescription("Role that bypasses entry requirements").setRequired(false)
      )
      .addRoleOption(option =>
        option.setName("required_role").setDescription("First required role").setRequired(false)
      )
      .addRoleOption(option =>
        option.setName("required_role_2").setDescription("Second required role").setRequired(false)
      )
      .addRoleOption(option =>
        option.setName("required_role_3").setDescription("Third required role").setRequired(false)
      )
      .addRoleOption(option =>
        option.setName("bonus_role").setDescription("Role that receives extra entries").setRequired(false)
      )
      .addIntegerOption(option =>
        option.setName("extra_entries").setDescription("Extra entries for the bonus role").setMinValue(0).setMaxValue(100).setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub.setName("end")
      .setDescription("End a giveaway early")
      .addStringOption(option =>
        option.setName("message_id").setDescription("Giveaway message ID").setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName("reroll")
      .setDescription("Choose a new winner")
      .addStringOption(option =>
        option.setName("message_id").setDescription("Giveaway message ID").setRequired(true)
      )
  );

// ==========================================
// BOT READY
// ==========================================

client.once(Events.ClientReady, async readyClient => {
  console.log(`VORTEX is online as ${readyClient.user.tag}`);

  readyClient.user.setActivity("VORTEX Giveaways", {
    type: ActivityType.Watching
  });

  try {
    await readyClient.application.commands.set([giveawayCommand]);
    console.log("Registered /giveaway start, end, and reroll.");
  } catch (error) {
    console.error("Slash command registration failed:", error);
  }

  setInterval(() => {
    checkGiveaways().catch(console.error);
  }, 15000);
});

// ==========================================
// SLASH COMMAND HANDLER
// ==========================================

client.on(Events.InteractionCreate, async interaction => {
  try {
    // /giveaway commands
    if (interaction.isChatInputCommand() && interaction.commandName === "giveaway") {
      if (!hasStaffRole(interaction.member)) {
        return interaction.reply({
          content: "❌ You need an authorized staff role to manage giveaways.",
          ephemeral: true
        });
      }

      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "start") {
        const prize = interaction.options.getString("prize");
        const durationText = interaction.options.getString("duration");
        const duration = parseDuration(durationText);
        const winnerCount = interaction.options.getInteger("winners");
        const channel = interaction.options.getChannel("channel");

        if (!duration) {
          return interaction.reply({
            content: "❌ Invalid duration. Use formats like `10m`, `2h`, or `1d`.",
            ephemeral: true
          });
        }

        if (duration > 30 * 24 * 60 * 60 * 1000) {
          return interaction.reply({
            content: "❌ Maximum giveaway duration is 30 days.",
            ephemeral: true
          });
        }

        const image = interaction.options.getString("image");
        if (image && !/^https?:\/\/\S+$/i.test(image)) {
          return interaction.reply({
            content: "❌ The image must be a valid HTTP or HTTPS URL.",
            ephemeral: true
          });
        }

        const claimText = interaction.options.getString("claim_time");
        let claimTime = 0;

        if (claimText) {
          claimTime = parseDuration(claimText);

          if (!claimTime || claimTime > 7 * 24 * 60 * 60 * 1000) {
            return interaction.reply({
              content: "❌ Invalid claim time. Use `10m`, `1h`, etc. Maximum: 7 days.",
              ephemeral: true
            });
          }
        }

        const requiredRoleIds = [
          interaction.options.getRole("required_role")?.id,
          interaction.options.getRole("required_role_2")?.id,
          interaction.options.getRole("required_role_3")?.id
        ].filter(Boolean);

        const bonusRole = interaction.options.getRole("bonus_role");
        const extraEntries = interaction.options.getInteger("extra_entries") || 0;

        if (extraEntries > 0 && !bonusRole) {
          return interaction.reply({
            content: "❌ Choose a bonus role if you want to give extra entries.",
            ephemeral: true
          });
        }

        await interaction.deferReply({ ephemeral: true });

        const giveaway = {
          prize,
          duration,
          endAt: Date.now() + duration,
          winnerCount,
          image,
          claimTime,
          dailyMessages: interaction.options.getInteger("daily_messages") || 0,
          bypassRoleId: interaction.options.getRole("bypass_role")?.id || null,
          requiredRoleIds,
          bonusRoleId: bonusRole?.id || null,
          extraEntries,
          entries: {},
          winners: [],
          claimed: [],
          ended: false,
          hostId: interaction.user.id,
          guildId: interaction.guildId,
          channelId: channel.id,
          messageId: null
        };

        const message = await channel.send({
          embeds: [buildGiveawayEmbed(giveaway)],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId("vortex_create_placeholder")
                .setLabel("Preparing giveaway...")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
            )
          ]
        });

        giveaway.messageId = message.id;
        data.giveaways[message.id] = giveaway;
        saveData();

        await message.edit({
          embeds: [buildGiveawayEmbed(giveaway)],
          components: [makeEntryRow(message.id)]
        });

        return interaction.editReply(`✅ Giveaway created in ${channel}.`);
      }

      if (subcommand === "end") {
        const messageId = interaction.options.getString("message_id");
        const giveaway = getGiveaway(messageId);

        if (!giveaway || giveaway.guildId !== interaction.guildId) {
          return interaction.reply({
            content: "❌ I couldn't find that giveaway in this server.",
            ephemeral: true
          });
        }

        if (giveaway.ended) {
          return interaction.reply({
            content: "❌ That giveaway has already ended.",
            ephemeral: true
          });
        }

        await finishGiveaway(giveaway, true);

        return interaction.reply({
          content: "✅ Giveaway ended.",
          ephemeral: true
        });
      }

      if (subcommand === "reroll") {
        const messageId = interaction.options.getString("message_id");
        const giveaway = getGiveaway(messageId);

        if (!giveaway || giveaway.guildId !== interaction.guildId) {
          return interaction.reply({
            content: "❌ I couldn't find that giveaway in this server.",
            ephemeral: true
          });
        }

        const excluded = new Set(giveaway.winners);
        const candidates = getWeightedEntries(giveaway).filter(
          id => !excluded.has(id)
        );

        if (!candidates.length) {
          return interaction.reply({
            content: "❌ No new eligible participants are available to reroll.",
            ephemeral: true
          });
        }

        const winner = candidates[Math.floor(Math.random() * candidates.length)];
        giveaway.winners.push(winner);
        saveData();

        const channel = await client.channels.fetch(giveaway.channelId);

        await channel.send(
          `🔁 New winner for **${giveaway.prize}**: <@${winner}>`
        );

        return interaction.reply({
          content: `✅ New winner selected: <@${winner}>`,
          ephemeral: true
        });
      }
    }

    // Giveaway buttons
    if (interaction.isButton()) {
      const [action, messageId] = interaction.customId.split(":");

      if (action === "vortex_enter") {
        const giveaway = getGiveaway(messageId);

        if (!giveaway || giveaway.guildId !== interaction.guildId) {
          return interaction.reply({
            content: "❌ Giveaway not found.",
            ephemeral: true
          });
        }

        if (giveaway.ended || giveaway.endAt <= Date.now()) {
          return interaction.reply({
            content: "❌ This giveaway has ended.",
            ephemeral: true
          });
        }

        const member = await interaction.guild.members.fetch(interaction.user.id);

        if (!hasGiveawayRequirements(member, giveaway)) {
          const missing = [];

          for (const roleId of giveaway.requiredRoleIds) {
            if (!member.roles.cache.has(roleId)) missing.push(`<@&${roleId}>`);
          }

          if (
            giveaway.dailyMessages > 0 &&
            getDailyCount(member.id) < giveaway.dailyMessages
          ) {
            missing.push(
              `${giveaway.dailyMessages} messages today (you have ${getDailyCount(member.id)})`
            );
          }

          return interaction.reply({
            content: `❌ You don't meet the requirements.\n${missing.join("\n") || "Check the giveaway requirements."}`,
            ephemeral: true
          });
        }

        if (giveaway.entries[interaction.user.id]) {
          return interaction.reply({
            content: "✅ You're already entered in this giveaway.",
            ephemeral: true
          });
        }

        let entries = 1;

        if (
          giveaway.bonusRoleId &&
          member.roles.cache.has(giveaway.bonusRoleId)
        ) {
          entries += giveaway.extraEntries;
        }

        giveaway.entries[interaction.user.id] = {
          entries,
          enteredAt: Date.now()
        };

        saveData();
        await updateGiveawayMessage(giveaway);

        return interaction.reply({
          content: `✅ You entered **${giveaway.prize}** with **${entries} entr${entries === 1 ? "y" : "ies"}**!`,
          ephemeral: true
        });
      }

      if (action === "vortex_participants") {
        const giveaway = getGiveaway(messageId);

        if (!giveaway) {
          return interaction.reply({
            content: "❌ Giveaway not found.",
            ephemeral: true
          });
        }

        const entries = Object.entries(giveaway.entries);
        const lines = entries.slice(0, 50).map(
          ([userId, entry], index) =>
            `${index + 1}. <@${userId}> — ${entry.entries || 1} entr${(entry.entries || 1) === 1 ? "y" : "ies"}`
        );

        const embed = new EmbedBuilder()
          .setColor(0x7c3aed)
          .setTitle(`👥 Participants — ${giveaway.prize}`)
          .setDescription(
            lines.length
              ? lines.join("\n")
              : "Nobody has entered yet."
          )
          .addFields({
            name: "Total participants",
            value: String(entries.length),
            inline: true
          })
          .setFooter({
            text: entries.length > 50
              ? "Showing the first 50 participants."
              : "VORTEX Giveaways"
          });

        const components = [];

        if (hasStaffRole(interaction.member) && entries.length > 0) {
          const menu = makeRemovalMenu(giveaway);
          if (menu) components.push(menu);
        }

        return interaction.reply({
          embeds: [embed],
          components,
          ephemeral: true
        });
      }

      if (action === "vortex_claim") {
        const giveaway = getGiveaway(messageId);

        if (!giveaway || !giveaway.ended) {
          return interaction.reply({
            content: "❌ This giveaway isn't ready to claim.",
            ephemeral: true
          });
        }

        if (!giveaway.winners.includes(interaction.user.id)) {
          return interaction.reply({
            content: "❌ You're not one of the selected winners.",
            ephemeral: true
          });
        }

        if (giveaway.claimed.includes(interaction.user.id)) {
          return interaction.reply({
            content: "✅ You've already claimed this prize.",
            ephemeral: true
          });
        }

        giveaway.claimed.push(interaction.user.id);
        saveData();

        const ticketChannel = process.env.TICKETS_CHANNEL_ID;

        if (ticketChannel) {
          return interaction.reply({
            content: `✅ Your prize claim has been recorded! Please open a ticket in <#${ticketChannel}> to arrange your prize.`,
            ephemeral: true
          });
        }

        return interaction.reply({
          content: "✅ Your prize claim has been recorded! Please contact the giveaway staff to arrange your prize.",
          ephemeral: true
        });
      }
    }

    // Authorized staff removing participants
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("vortex_remove:")
    ) {
      if (!hasStaffRole(interaction.member)) {
        return interaction.reply({
          content: "❌ You are not authorized to remove participants.",
          ephemeral: true
        });
      }

      const messageId = interaction.customId.split(":")[1];
      const giveaway = getGiveaway(messageId);

      if (!giveaway) {
        return interaction.reply({
          content: "❌ Giveaway not found.",
          ephemeral: true
        });
      }

      let removed = 0;

      for (const userId of interaction.values) {
        if (giveaway.entries[userId]) {
          delete giveaway.entries[userId];
          removed++;
        }
      }

      saveData();
      await updateGiveawayMessage(giveaway);

      return interaction.update({
        content: `✅ Removed ${removed} participant(s).`,
        embeds: [],
        components: []
      });
    }
  } catch (error) {
    console.error("Interaction error:", error);

    const response = {
      content: "❌ Something went wrong. Check the Railway logs.",
      ephemeral: true
    };

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response).catch(() => {});
    } else {
      await interaction.reply(response).catch(() => {});
    }
  }
});

// ==========================================
// MODERATION PREFIX COMMANDS
// ==========================================

client.on(Events.MessageCreate, async message => {
  if (!message.guild || message.author.bot) return;

  // Track daily message requirements
  const userId = message.author.id;
  const today = todayKey();

  data.dailyCounts[userId] ||= {};
  data.dailyCounts[userId][today] ||= 0;
  data.dailyCounts[userId][today]++;

  // Remove old daily counts
  for (const [id, counts] of Object.entries(data.dailyCounts)) {
    for (const date of Object.keys(counts)) {
      if (date !== today) delete counts[date];
    }

    if (Object.keys(counts).length === 0) delete data.dailyCounts[id];
  }

  saveData();

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = (args.shift() || "").toLowerCase();

  if (!command) return;

  const reply = text => message.reply(text).catch(() => {});

  // HELP
  if (command === "help") {
    return reply(
      [
        "**VORTEX Commands**",
        "",
        "**Moderation — requires the appropriate Discord permissions**",
        "`c!warn @user reason`",
        "`c!warnings @user`",
        "`c!modlogs @user`",
        "`c!modlogs clear @user`",
        "`c!clear amount`",
        "`c!mute @user 10m reason`",
        "`c!unmute @user`",
        "`c!kick @user reason`",
        "`c!ban @user reason`",
        "",
        "**Giveaways**",
        "`/giveaway start`",
        "`/giveaway end`",
        "`/giveaway reroll`"
      ].join("\n")
    );
  }

  // WARNING COMMANDS
  if (command === "warn") {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return reply("❌ You need the **Moderate Members** permission.");
    }

    const targetId = getTargetId(args.shift());
    const reason = args.join(" ") || "No reason provided";

    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      return reply("Usage: `c!warn @user reason`");
    }

    if (targetId === message.author.id) {
      return reply("❌ You cannot warn yourself.");
    }

    const key = `${message.guild.id}:${targetId}`;
    data.warnings[key] ||= [];

    const warning = {
      moderatorId: message.author.id,
      reason,
      timestamp: Date.now()
    };

    data.warnings[key].push(warning);
    addModLog(message.guild.id, targetId, "WARN", message.author.id, reason);
    saveData();

    return reply(`⚠️ <@${targetId}> has been warned.\n**Reason:** ${safeText(reason)}`);
  }

  if (command === "warnings") {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return reply("❌ You need the **Moderate Members** permission.");
    }

    const targetId = getTargetId(args[0]);

    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      return reply("Usage: `c!warnings @user`");
    }

    const warnings = data.warnings[`${message.guild.id}:${targetId}`] || [];

    if (!warnings.length) {
      return reply(`✅ <@${targetId}> has no saved warnings.`);
    }

    const lines = warnings.slice(-10).map(
      (warning, index) =>
        `**${index + 1}.** ${safeText(warning.reason, 200)} — <@${warning.moderatorId}>`
    );

    return reply(`**Warnings for <@${targetId}>**\n${lines.join("\n")}`);
  }

  // MODLOGS
  if (command === "modlogs") {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return reply("❌ You need the **Moderate Members** permission.");
    }

    if (args[0]?.toLowerCase() === "clear") {
      const targetId = getTargetId(args[1]);

      if (!targetId || !/^\d{17,20}$/.test(targetId)) {
        return reply("Usage: `c!modlogs clear @user`");
      }

      delete data.modlogs[`${message.guild.id}:${targetId}`];
      delete data.warnings[`${message.guild.id}:${targetId}`];
      saveData();

      return reply(`✅ Saved moderation logs and warnings cleared for <@${targetId}>.`);
    }

    const targetId = getTargetId(args[0]);

    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      return reply("Usage: `c!modlogs @user`");
    }

    const logs = data.modlogs[`${message.guild.id}:${targetId}`] || [];

    if (!logs.length) {
      return reply(`No moderation logs found for <@${targetId}>.`);
    }

    const lines = logs.slice(-10).reverse().map(log => {
      const date = new Date(log.timestamp).toLocaleString("en-GB");
      return `**${log.action}** — ${safeText(log.reason, 180)}\nModerator: <@${log.moderatorId}> • ${date}`;
    });

    return reply(`**Moderation logs for <@${targetId}>**\n\n${lines.join("\n\n")}`);
  }

  // CLEAR MESSAGES
  if (command === "clear") {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return reply("❌ You need the **Manage Messages** permission.");
    }

    const amount = Number(args[0]);

    if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
      return reply("Usage: `c!clear 1-100`");
    }

    try {
      const deleted = await message.channel.bulkDelete(amount + 1, true);
      const confirmation = await message.channel.send(
        `🧹 Deleted ${Math.max(0, deleted.size - 1)} message(s).`
      );

      setTimeout(() => confirmation.delete().catch(() => {}), 5000);
    } catch {
      return reply("❌ I couldn't delete those messages. Check my **Manage Messages** permission.");
    }

    return;
  }

  // MUTE / TIMEOUT
  if (command === "mute") {
    if (!canModerate(message.member)) {
      return reply("❌ You need the **Moderate Members** permission.");
    }

    const targetId = getTargetId(args.shift());
    const durationText = args.shift();
    const duration = parseDuration(durationText);
    const reason = args.join(" ") || "No reason provided";

    if (!targetId || !/^\d{17,20}$/.test(targetId) || !duration) {
      return reply("Usage: `c!mute @user 10m reason` — maximum 28 days.");
    }

    if (duration > 28 * 24 * 60 * 60 * 1000) {
      return reply("❌ Discord timeouts cannot exceed 28 days.");
    }

    try {
      const member = await message.guild.members.fetch(targetId);

      if (!member.moderatable) {
        return reply("❌ I can't timeout that member. Check my role position and permissions.");
      }

      await member.timeout(duration, reason);
      addModLog(message.guild.id, targetId, "TIMEOUT", message.author.id, reason);

      return reply(`🔇 <@${targetId}> has been timed out for ${formatDuration(duration)}.\n**Reason:** ${safeText(reason)}`);
    } catch {
      return reply("❌ Couldn't timeout that user.");
    }
  }

  if (command === "unmute") {
    if (!canModerate(message.member)) {
      return reply("❌ You need the **Moderate Members** permission.");
    }

    const targetId = getTargetId(args[0]);

    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      return reply("Usage: `c!unmute @user`");
    }

    try {
      const member = await message.guild.members.fetch(targetId);

      if (!member.moderatable) {
        return reply("❌ I can't remove that member's timeout. Check role hierarchy.");
      }

      await member.timeout(null, `Timeout removed by ${message.author.tag}`);
      addModLog(message.guild.id, targetId, "UNTIMEOUT", message.author.id, "Timeout removed");

      return reply(`🔊 Timeout removed for <@${targetId}>.`);
    } catch {
      return reply("❌ Couldn't remove that user's timeout.");
    }
  }

  // KICK
  if (command === "kick") {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return reply("❌ You need the **Kick Members** permission.");
    }

    const targetId = getTargetId(args.shift());
    const reason = args.join(" ") || "No reason provided";

    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      return reply("Usage: `c!kick @user reason`");
    }

    try {
      const member = await message.guild.members.fetch(targetId);

      if (!member.kickable) {
        return reply("❌ I can't kick that member. Check role hierarchy and permissions.");
      }

      await member.kick(reason);
      addModLog(message.guild.id, targetId, "KICK", message.author.id, reason);

      return reply(`👢 <@${targetId}> was kicked.\n**Reason:** ${safeText(reason)}`);
    } catch {
      return reply("❌ Couldn't kick that user.");
    }
  }

  // BAN
  if (command === "ban") {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return reply("❌ You need the **Ban Members** permission.");
    }

    const targetId = getTargetId(args.shift());
    const reason = args.join(" ") || "No reason provided";

    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      return reply("Usage: `c!ban @user reason`");
    }

    try {
      const member = await message.guild.members.fetch(targetId);

      if (!member.bannable) {
        return reply("❌ I can't ban that member. Check role hierarchy and permissions.");
      }

      await member.ban({ reason });
      addModLog(message.guild.id, targetId, "BAN", message.author.id, reason);

      return reply(`🔨 <@${targetId}> was banned.\n**Reason:** ${safeText(reason)}`);
    } catch {
      return reply("❌ Couldn't ban that user.");
    }
  }
});

// ==========================================
// BASIC DASHBOARD
// ==========================================

// Uses HTTP Basic Authentication.
// Add DASHBOARD_PASSWORD as a Railway Variable before opening the dashboard.

app.get("/", (req, res) => {
  if (!process.env.DASHBOARD_PASSWORD) {
    return res.status(503).send(`
      <html>
        <body style="font-family:Arial;background:#0b0b12;color:white;padding:40px">
          <h1>VORTEX Dashboard</h1>
          <p>Dashboard locked. Add <b>DASHBOARD_PASSWORD</b> to your Railway Variables.</p>
        </body>
      </html>
    `);
  }

  const header = req.headers.authorization || "";
  const [type, credentials] = header.split(" ");
  let suppliedPassword = "";

  if (type === "Basic" && credentials) {
    try {
      suppliedPassword = Buffer.from(credentials, "base64")
        .toString("utf8")
        .split(":")
        .slice(1)
        .join(":");
    } catch {}
  }

  if (type !== "Basic" || suppliedPassword !== process.env.DASHBOARD_PASSWORD) {
    res.setHeader("WWW-Authenticate", 'Basic realm="VORTEX Dashboard"');
    return res.status(401).send("Authentication required.");
  }

  const guilds = client.guilds.cache.size;
  const giveawayCount = Object.keys(data.giveaways).length;
  const activeGiveaways = Object.values(data.giveaways).filter(g => !g.ended).length;
  const warningCount = Object.values(data.warnings).reduce((sum, list) => sum + list.length, 0);

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>VORTEX Dashboard</title>
      <style>
        body { margin:0; padding:30px; font-family:Arial,sans-serif; background:#0b0b12; color:#f5f5f5; }
        h1 { color:#a78bfa; }
        .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:16px; }
        .card { background:#171725; border:1px solid #302b48; border-radius:12px; padding:22px; }
        .number { font-size:32px; font-weight:bold; margin-top:12px; }
        .muted { color:#b7b5c8; }
      </style>
    </head>
    <body>
      <h1>VORTEX Dashboard</h1>
      <p class="muted">Giveaway and moderation bot overview</p>
      <div class="grid">
        <div class="card"><div class="muted">Bot status</div><div class="number">${client.isReady() ? "Online" : "Starting"}</div></div>
        <div class="card"><div class="muted">Servers</div><div class="number">${guilds}</div></div>
        <div class="card"><div class="muted">Active giveaways</div><div class="number">${activeGiveaways}</div></div>
        <div class="card"><div class="muted">Total giveaways</div><div class="number">${giveawayCount}</div></div>
        <div class="card"><div class="muted">Saved warnings</div><div class="number">${warningCount}</div></div>
      </div>
      <p class="muted" style="margin-top:30px">VORTEX • Dashboard overview</p>
    </body>
    </html>
  `);
});

app.listen(PORT, () => {
  console.log(`VORTEX Dashboard: listening on port ${PORT}`);
});

// ==========================================
// START BOT
// ==========================================

if (!process.env.DISCORD_TOKEN) {
  console.error("ERROR: DISCORD_TOKEN is missing from your environment variables.");
} else {
  client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error("Discord login failed:", error);
  });
}
