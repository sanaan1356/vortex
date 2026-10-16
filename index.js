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
  StringSelectMenuBuilder
} = require("discord.js");

// ==========================================
// VORTEX CONFIGURATION
// ==========================================

const PREFIX = "c!";
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data.json");

const app = express();
app.use(express.json());

const STAFF_ROLES = [
  { name: "Leader of Staff", id: "1543659012921237555" },
  { name: "Head Admin", id: "1549070828954456134" },
  { name: "Admin", id: "1543658230557708319" },
  { name: "Head Mod", id: "1546166364555976795" },
  { name: "Mod", id: "1543658446954569829" },
  { name: "TMOD", id: "1543658722671202506" }
];

const GENERAL_STAFF_ROLE_ID = "1543657449200943214";
const STAFF_ANNOUNCEMENT_CHANNEL_ID = "1543654452978778162";

// ==========================================
// DISCORD CLIENT
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ==========================================
// DATABASE
// ==========================================

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

      return {
        giveaways: Array.isArray(saved.giveaways)
          ? saved.giveaways
          : [],
        warnings: saved.warnings || {},
        dailyCounts: saved.dailyCounts || {}
      };
    }
  } catch (error) {
    console.error("Database read error:", error);
  }

  return {
    giveaways: [],
    warnings: {},
    dailyCounts: {}
  };
}

const data = loadData();

function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("Database save error:", error);
  }
}

// ==========================================
// GENERAL HELPERS
// ==========================================

function parseDuration(input) {
  const match = String(input || "")
    .trim()
    .match(/^(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hours?|d|days?)$/i);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  let multiplier;

  if (["s", "sec", "second", "seconds"].includes(unit)) {
    multiplier = 1000;
  } else if (["m", "min", "minute", "minutes"].includes(unit)) {
    multiplier = 60000;
  } else if (["h", "hour", "hours"].includes(unit)) {
    multiplier = 3600000;
  } else {
    multiplier = 86400000;
  }

  const result = amount * multiplier;

  return Number.isFinite(result) && result > 0
    ? result
    : null;
}

function formatDuration(ms) {
  if (ms < 60000) return Math.floor(ms / 1000) + "s";
  if (ms < 3600000) return Math.floor(ms / 60000) + "m";
  if (ms < 86400000) return Math.floor(ms / 3600000) + "h";
  return Math.floor(ms / 86400000) + "d";
}

function getUserId(input) {
  return String(input || "").replace(/[<@!>]/g, "");
}

function getTodayKey(guildId, userId) {
  return guildId + ":" + userId + ":" +
    new Date().toISOString().slice(0, 10);
}

function getDailyMessageCount(guildId, userId) {
  return Number(data.dailyCounts[getTodayKey(guildId, userId)] || 0);
}

function hasRole(member, roleId) {
  return Boolean(roleId && member.roles.cache.has(roleId));
}

function normalizeGiveaway(giveaway) {
  if (!giveaway) return null;

  // Support older versions of the giveaway data.
  if (giveaway.endAt == null) {
    giveaway.endAt = giveaway.endTime || Date.now();
  }

  if (giveaway.winnerCount == null) {
    giveaway.winnerCount = giveaway.winnersCount ||
      (typeof giveaway.winners === "number" ? giveaway.winners : 1);
  }

  if (giveaway.claimTimeMs == null) {
    giveaway.claimTimeMs = giveaway.claimTime || 600000;
  }

  giveaway.entries ||= [];
  giveaway.winners = Array.isArray(giveaway.winners)
    ? giveaway.winners
    : [];
  giveaway.claimedIds ||= [];
  giveaway.claimStartedIds ||= [];
  giveaway.requiredRoleIds ||= [];

  return giveaway;
}

function getGiveaway(messageId) {
  const giveaway = data.giveaways.find(
    item => String(item.messageId) === String(messageId)
  );

  return normalizeGiveaway(giveaway);
}

function findStaffGuild() {
  return client.guilds.cache.find(guild =>
    STAFF_ROLES.some(role => guild.roles.cache.has(role.id)) ||
    guild.roles.cache.has(GENERAL_STAFF_ROLE_ID)
  );
}

function isStaffMember(member) {
  return member.roles.cache.has(GENERAL_STAFF_ROLE_ID) ||
    STAFF_ROLES.some(role => member.roles.cache.has(role.id));
}

function getStaffRoleName(member) {
  const role = STAFF_ROLES.find(item =>
    member.roles.cache.has(item.id)
  );

  return role ? role.name : "Staff";
}

// ==========================================
// GIVEAWAY BUTTONS
// ==========================================

function makeEntryRow(giveaway) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("vortex_enter:" + giveaway.messageId)
      .setLabel("Enter Giveaway")
      .setEmoji("🎉")
      .setStyle(ButtonStyle.Success)
      .setDisabled(Boolean(giveaway.ended)),
    new ButtonBuilder()
      .setCustomId("vortex_participants:" + giveaway.messageId)
      .setLabel("Participants")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary)
  );
}

function makeClaimRow(giveaway) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("vortex_claim:" + giveaway.messageId)
      .setLabel("Claim Prize")
      .setEmoji("🏆")
      .setStyle(ButtonStyle.Primary)
  );
}

// ==========================================
// GIVEAWAY EMBED
// ==========================================

function buildGiveawayEmbed(giveaway) {
  normalizeGiveaway(giveaway);

  const embed = new EmbedBuilder()
    .setColor(giveaway.ended ? 0x4b5563 : 0x8b5cf6)
    .setTitle("🟪 V O R T E X  •  G I V E A W A Y")
    .setDescription(
      "## 🎉 " + giveaway.prize +
      (giveaway.ended
        ? "\n\nThis giveaway has ended."
        : "\n\n━━━━━━━━━━━━━━━━━━━━\n" +
          "Click **Enter Giveaway** below to join!\n" +
          "Good luck, everyone. 💜")
    )
    .addFields(
      {
        name: "🏆 PRIZE",
        value: "**" + giveaway.prize + "**",
        inline: true
      },
      {
        name: "👑 WINNERS",
        value: "**" + giveaway.winnerCount + "**",
        inline: true
      },
      {
        name: "🎟️ PARTICIPANTS",
        value: "**" + giveaway.entries.length + "**",
        inline: true
      }
    )
    .setFooter({
      text: "VORTEX Giveaways • Fair chances, big wins"
    })
    .setTimestamp();

  if (!giveaway.ended) {
    embed.addFields({
      name: "⏰ TIME LEFT",
      value: "<t:" + Math.floor(giveaway.endAt / 1000) + ":R>",
      inline: true
    });
  }

  if (giveaway.requiredRoleIds.length) {
    embed.addFields({
      name: "🔒 REQUIRED ROLES",
      value: giveaway.requiredRoleIds
        .map(id => "<@&" + id + ">")
        .join(", "),
      inline: false
    });
  }

  if (giveaway.dailyMessages > 0) {
    embed.addFields({
      name: "💬 DAILY MESSAGE REQUIREMENT",
      value: "Send **" + giveaway.dailyMessages +
        " messages** today to qualify.",
      inline: false
    });
  }

  if (giveaway.bonusRoleId && giveaway.extraEntries > 0) {
    embed.addFields({
      name: "✨ EXTRA ENTRIES",
      value: "Members with <@&" + giveaway.bonusRoleId +
        "> receive **+" + giveaway.extraEntries + " extra entries**.",
      inline: false
    });
  }

  if (giveaway.bypassRoleId) {
    embed.addFields({
      name: "🛡️ REQUIREMENT BYPASS",
      value: "<@&" + giveaway.bypassRoleId +
        "> can bypass role and daily-message requirements.",
      inline: false
    });
  }

  if (giveaway.claimDeadline && giveaway.ended) {
    embed.addFields({
      name: "🏆 CLAIM DEADLINE",
      value: "<t:" + Math.floor(giveaway.claimDeadline / 1000) + ":R>",
      inline: false
    });
  }

  if (giveaway.image) {
    embed.setImage(giveaway.image);
  }

  return embed;
}

// ==========================================
// WINNER SELECTION
// ==========================================

function pickWinners(giveaway, excludedIds = []) {
  normalizeGiveaway(giveaway);

  const excluded = new Set(excludedIds);
  const tickets = [];
  const guild = client.guilds.cache.get(giveaway.guildId);

  for (const userId of giveaway.entries) {
    if (excluded.has(userId)) continue;

    let count = 1;

    const member = guild
      ? guild.members.cache.get(userId)
      : null;

    if (
      member &&
      giveaway.bonusRoleId &&
      giveaway.extraEntries > 0 &&
      hasRole(member, giveaway.bonusRoleId)
    ) {
      count += giveaway.extraEntries;
    }

    for (let i = 0; i < count; i++) {
      tickets.push(userId);
    }
  }

  const winners = [];

  while (
    tickets.length > 0 &&
    winners.length < giveaway.winnerCount
  ) {
    const chosen = tickets[
      Math.floor(Math.random() * tickets.length)
    ];

    if (!winners.includes(chosen)) {
      winners.push(chosen);
    }

    for (let i = tickets.length - 1; i >= 0; i--) {
      if (tickets[i] === chosen) {
        tickets.splice(i, 1);
      }
    }
  }

  return winners;
}

// ==========================================
// END GIVEAWAY
// ==========================================

async function endGiveaway(giveaway) {
  normalizeGiveaway(giveaway);

  if (giveaway.ended) return;

  giveaway.ended = true;
  giveaway.endedAt = Date.now();
  giveaway.winners = pickWinners(giveaway);
  giveaway.claimedIds ||= [];
  giveaway.claimStartedIds ||= [];

  giveaway.claimDeadline =
    giveaway.claimTimeMs && giveaway.winners.length
      ? Date.now() + giveaway.claimTimeMs
      : null;

  giveaway.claimsResolved = !giveaway.claimDeadline;

  saveData();

  const guild = client.guilds.cache.get(giveaway.guildId);

  const channel = guild
    ? await guild.channels.fetch(giveaway.channelId).catch(() => null)
    : null;

  if (!channel || !channel.isTextBased()) return;

  const original = await channel.messages
    .fetch(giveaway.messageId)
    .catch(() => null);

  if (original) {
    await original.edit({
      embeds: [buildGiveawayEmbed(giveaway)],
      components: [makeEntryRow(giveaway)]
    }).catch(console.error);
  }

  if (!giveaway.winners.length) {
    await channel.send(
      "The giveaway for **" + giveaway.prize +
      "** has ended. Nobody entered."
    );
    return;
  }

  const announcement = {
    content:
      "🎉 **GIVEAWAY ENDED!**\n" +
      "🏆 Prize: **" + giveaway.prize + "**\n" +
      "👑 Winner(s): " +
      giveaway.winners.map(id => "<@" + id + ">").join(", "),
    allowedMentions: {
      users: giveaway.winners
    }
  };

  if (giveaway.claimDeadline) {
    announcement.content +=
      "\n\nWinners must claim within " +
      formatDuration(giveaway.claimTimeMs) + ".";

    announcement.components = [makeClaimRow(giveaway)];
  }

  await channel.send(announcement).catch(console.error);
}

// ==========================================
// GIVEAWAY SCHEDULER AND CLAIM DEADLINES
// ==========================================

async function checkGiveaways() {
  const now = Date.now();

  for (const giveaway of data.giveaways) {
    normalizeGiveaway(giveaway);

    if (!giveaway.ended && giveaway.endAt <= now) {
      await endGiveaway(giveaway).catch(console.error);
      continue;
    }

    if (
      !giveaway.ended ||
      !giveaway.claimDeadline ||
      giveaway.claimsResolved ||
      giveaway.claimDeadline > now
    ) {
      continue;
    }

    const claimed = giveaway.winners.filter(id =>
      giveaway.claimedIds.includes(id)
    );

    const unclaimed = giveaway.winners.filter(id =>
      !giveaway.claimedIds.includes(id)
    );

    if (!unclaimed.length) {
      giveaway.claimsResolved = true;
      saveData();
      continue;
    }

    const replacements = pickWinners(
      giveaway,
      giveaway.winners
    ).slice(0, unclaimed.length);

    giveaway.winners = [...claimed, ...replacements];
    giveaway.claimedIds = [...claimed];
    giveaway.claimStartedIds = [];
    giveaway.claimsResolved = true;

    saveData();

    const guild = client.guilds.cache.get(giveaway.guildId);

    const channel = guild
      ? await guild.channels.fetch(giveaway.channelId).catch(() => null)
      : null;

    if (channel && channel.isTextBased()) {
      await channel.send({
        content: replacements.length
          ? "⏰ Claim time expired. Replacement winner(s) for **" +
            giveaway.prize + "**: " +
            replacements.map(id => "<@" + id + ">").join(", ")
          : "⏰ Claim time expired for **" +
            giveaway.prize +
            "**. No replacement winners were available.",
        allowedMentions: {
          users: replacements
        }
      }).catch(console.error);
    }
  }
}

// ==========================================
// SLASH COMMANDS
// ==========================================

const giveawayCommand = new SlashCommandBuilder()
  .setName("giveaway")
  .setDescription("Manage giveaways.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

  .addSubcommand(sub => sub
    .setName("start")
    .setDescription("Start a giveaway.")

    .addStringOption(o =>
      o.setName("prize")
        .setDescription("Giveaway prize")
        .setRequired(true)
    )

    .addStringOption(o =>
      o.setName("duration")
        .setDescription("Example: 10m, 2h, 7d")
        .setRequired(true)
    )

    .addIntegerOption(o =>
      o.setName("winners")
        .setDescription("Number of winners")
        .setMinValue(1)
        .setMaxValue(20)
        .setRequired(true)
    )

    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Giveaway channel")
        .addChannelTypes(ChannelType.GuildText)
    )

    .addStringOption(o =>
      o.setName("image")
        .setDescription("Optional image URL")
    )

    .addStringOption(o =>
      o.setName("claim_time")
        .setDescription("Claim time, e.g. 10m or 1h")
    )

    .addIntegerOption(o =>
      o.setName("daily_messages")
        .setDescription("Daily messages required")
        .setMinValue(0)
        .setMaxValue(1000)
    )

    .addRoleOption(o =>
      o.setName("bypass_role")
        .setDescription("Role that bypasses requirements")
    )

    .addRoleOption(o =>
      o.setName("required_role")
        .setDescription("First required role")
    )

    .addRoleOption(o =>
      o.setName("required_role_2")
        .setDescription("Second required role")
    )

    .addRoleOption(o =>
      o.setName("required_role_3")
        .setDescription("Third required role")
    )

    .addRoleOption(o =>
      o.setName("bonus_role")
        .setDescription("Role receiving extra entries")
    )

    .addIntegerOption(o =>
      o.setName("extra_entries")
        .setDescription("Extra entries for bonus role")
        .setMinValue(0)
        .setMaxValue(100)
    )
  )

  .addSubcommand(sub => sub
    .setName("end")
    .setDescription("End a giveaway.")

    .addStringOption(o =>
      o.setName("message_id")
        .setDescription("Giveaway message ID")
        .setRequired(true)
    )
  )

  .addSubcommand(sub => sub
    .setName("reroll")
    .setDescription("Reroll winners.")

    .addStringOption(o =>
      o.setName("message_id")
        .setDescription("Giveaway message ID")
        .setRequired(true)
    )
  );

// ==========================================
// BOT READY
// ==========================================

client.once(Events.ClientReady, async readyClient => {
  console.log("VORTEX is online as " + readyClient.user.tag);

  try {
    await readyClient.application.commands.set([
      giveawayCommand.toJSON()
    ]);

    console.log("Registered /giveaway start, end, and reroll.");
  } catch (error) {
    console.error("Slash command registration error:", error);
  }

  readyClient.user.setActivity("giveaways & moderation");

  await checkGiveaways().catch(console.error);

  setInterval(() => {
    checkGiveaways().catch(console.error);
  }, 15000);
});

// ==========================================
// INTERACTIONS: BUTTONS, MENUS AND COMMANDS
// ==========================================

client.on(Events.InteractionCreate, async interaction => {
  try {
    // PARTICIPANT REMOVAL MENU
    if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith("vortex_remove:")
    ) {
      const messageId = interaction.customId.split(":")[1];
      const giveaway = getGiveaway(messageId);

      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.ManageGuild
        )
      ) {
        return interaction.reply({
          content: "❌ Only authorized staff can remove participants.",
          ephemeral: true
        });
      }

      if (!giveaway || giveaway.guildId !== interaction.guildId) {
        return interaction.reply({
          content: "❌ Giveaway not found.",
          ephemeral: true
        });
      }

      const userId = interaction.values[0];

      giveaway.entries = giveaway.entries.filter(
        id => id !== userId
      );

      saveData();

      const channel = await interaction.guild.channels
        .fetch(giveaway.channelId)
        .catch(() => null);

      const original = channel && channel.isTextBased()
        ? await channel.messages.fetch(giveaway.messageId).catch(() => null)
        : null;

      if (original) {
        await original.edit({
          embeds: [buildGiveawayEmbed(giveaway)],
          components: [makeEntryRow(giveaway)]
        }).catch(console.error);
      }

      return interaction.update({
        content: "✅ Removed <@" + userId + "> from the giveaway.",
        embeds: [],
        components: []
      });
    }

    // GIVEAWAY BUTTONS
    if (interaction.isButton()) {
      const parts = interaction.customId.split(":");
      const action = parts[0];
      const messageId = parts[1];
      const giveaway = getGiveaway(messageId);

      if (!giveaway || giveaway.guildId !== interaction.guildId) {
        return interaction.reply({
          content: "❌ This giveaway could not be found.",
          ephemeral: true
        });
      }

         // ENTER GIVEAWAY
      if (action === "vortex_enter") {
        if (giveaway.ended || giveaway.endAt <= Date.now()) {
          return interaction.reply({
            content: "❌ This giveaway has ended.",
            ephemeral: true
          });
        }

        const member = interaction.member;
        const userId = interaction.user.id;

        // Check required roles
        const memberRoles = member.roles.cache;
        const hasRequiredRole =
          !giveaway.requiredRoles ||
          giveaway.requiredRoles.length === 0 ||
          giveaway.requiredRoles.some(roleId => memberRoles.has(roleId));

        const canBypass =
          giveaway.bypassRole &&
          memberRoles.has(giveaway.bypassRole);

        if (!hasRequiredRole && !canBypass) {
          return interaction.reply({
            content: "❌ You don't have the required role to enter.",
            ephemeral: true
          });
        }

        // Check whether already entered
        giveaway.entries ??= {};

        if (giveaway.entries[userId]) {
          return interaction.reply({
            content: "❌ You have already entered this giveaway.",
            ephemeral: true
          });
        }

        // Calculate entries
        let extraEntries = 0;

        if (giveaway.extraEntryRoles) {
          for (const item of giveaway.extraEntryRoles) {
            if (memberRoles.has(item.roleId)) {
              extraEntries += Number(item.entries || 0);
            }
          }
        }

        giveaway.entries[userId] = {
          entries: 1 + extraEntries,
          enteredAt: Date.now()
        };

        saveData();

        return interaction.reply({
          content: `✅ You entered the giveaway with **${1 + extraEntries} entries**!`,
          ephemeral: true
        });
      }

      // Unknown button
      return interaction.reply({
        content: "❌ Unknown giveaway action.",
        ephemeral: true
      });
    }

    // Handle other interactions here if your original code had them.
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Something went wrong. Please try again.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// Start dashboard
app.listen(PORT, "0.0.0.0", () => {
  console.log("VORTEX Dashboard running on port " + PORT);
});

// Start bot
if (!process.env.DISCORD_TOKEN) {
  console.error("Missing DISCORD_TOKEN environment variable.");
} else {
  client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error("Discord login failed:", error);
  });
}
