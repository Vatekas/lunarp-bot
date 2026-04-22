import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  Events,
  GuildMember,
} from "discord.js";
import { logger } from "../lib/logger";

const GUILD_ID = "1455214577334751428";
const REVIEW_CHANNEL_ID = "1490789916995621050";

const STAR_LABELS: Record<string, string> = {
  "1": "⭐ 1 Žvaigždutė — Labai blogai",
  "2": "⭐⭐ 2 Žvaigždutės — Blogai",
  "3": "⭐⭐⭐ 3 Žvaigždutės — Vidutiniškai",
  "4": "⭐⭐⭐⭐ 4 Žvaigždutės — Gerai",
  "5": "⭐⭐⭐⭐⭐ 5 Žvaigždutės — Puikiai",
};

export function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is not set");
    return;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
    ],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot is ready");
    await postReviewPanel(readyClient);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // Step 1: Button → open modal to enter admin name
      if (interaction.isButton() && interaction.customId === "start_review") {
        await handleStartReview(interaction);
        return;
      }

      // Step 2: Admin selected from dropdown → show rating dropdown
      if (interaction.isStringSelectMenu() && interaction.customId === "select_admin") {
        await handleSelectAdmin(interaction);
        return;
      }

      // Step 3: Rating dropdown → open modal for review text
      if (interaction.isStringSelectMenu() && interaction.customId === "select_rating") {
        await handleSelectRating(interaction);
        return;
      }

      // Step 4: Review text modal submit → send to channel
      if (interaction.isModalSubmit() && interaction.customId.startsWith("review_modal_")) {
        await handleReviewModal(interaction);
        return;
      }
    } catch (err) {
      logger.error({ err }, "Error handling interaction");
      try {
        const msg = { content: "Įvyko klaida. Bandykite dar kartą.", ephemeral: true };
        if (interaction.isRepliable()) {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp(msg);
          } else {
            await interaction.reply(msg);
          }
        }
      } catch {}
    }
  });

  client.login(token).catch((err) => {
    logger.error({ err }, "Failed to login to Discord");
  });
}

async function postReviewPanel(client: Client) {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const channel = await guild.channels.fetch(REVIEW_CHANNEL_ID);

    if (!channel || !channel.isTextBased()) {
      logger.error("Review channel not found or not text-based");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Administracijos Atsiliepimai")
      .setDescription(
        "Pasidalinkite savo atsiliepimu apie serverio administraciją!\n\n*Visi atsiliepimai padeda mums tobulėti!*"
      )
      .addFields({
        name: "Kaip tai veikia:",
        value:
          "**1** Paspauskite mygtuką žemiau\n**2** Pasirinkite administratorių\n**3** Įvertinkite 1–5 žvaigždutėmis\n**4** Parašykite savo atsiliepimą",
      })
      .setFooter({ text: "Su pagarba, LUNARP.LT Serverio Administracija" })
      .setColor(0x5865f2);

    const button = new ButtonBuilder()
      .setCustomId("start_review")
      .setLabel("Palikti admin atsiliepimą")
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);

    await (channel as import("discord.js").TextChannel).send({
      embeds: [embed],
      components: [row],
    });

    logger.info("Review panel posted successfully");
  } catch (err) {
    logger.error({ err }, "Failed to post review panel");
  }
}

const ADMIN_ROLES = [
  "┋ Įkūrėjas",
  "┋Co.Savininkas",
  "┋Developeris",
  "┋Team Lead",
  "┋Vyr. Administratorius (-ė)",
  "┋Administratorius (-ė)",
  "┋Moderatorius (-ė)",
];

// Step 1: Fetch members with admin roles → show dropdown
async function handleStartReview(interaction: import("discord.js").ButtonInteraction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Klaida: serveris nerastas.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // Fetch all guild members via REST
  const allMembers = await guild.members.fetch();

  logger.info({ memberCount: allMembers.size }, "Fetched guild members");

  const seen = new Set<string>();
  const adminMembers: { id: string; name: string }[] = [];

  for (const [, member] of allMembers) {
    if (seen.has(member.id)) continue;
    const roleNames = member.roles.cache.map((r) => r.name);
    const hasRole = member.roles.cache.some((r) =>
      ADMIN_ROLES.some((name) => r.name.trim() === name.trim())
    );
    if (hasRole) {
      seen.add(member.id);
      adminMembers.push({ id: member.id, name: member.displayName });
    }
    if (roleNames.length > 1) {
      logger.info({ member: member.displayName, roles: roleNames }, "Member roles");
    }
  }

  logger.info({ adminCount: adminMembers.length }, "Admin members found");

  if (adminMembers.length === 0) {
    // Show all role names found for debugging
    const allRoleNames = guild.roles.cache.map((r) => r.name);
    logger.info({ allRoles: allRoleNames }, "All guild roles");
    await interaction.editReply({
      content: "Nerasta jokių administratorių. Įsitikinkite, kad Developer Portal įjungtas **SERVER MEMBERS INTENT**.",
    });
    return;
  }

  const options = adminMembers.slice(0, 25).map((m) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(m.name)
      .setValue(m.id)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("select_admin")
    .setPlaceholder("Pasirinkite administratorių")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.editReply({
    content: "**1/3:** Pasirinkite administratorių, kurį norite įvertinti:",
    components: [row],
  });
}

// Step 2: Admin selected → show rating dropdown
async function handleSelectAdmin(interaction: import("discord.js").StringSelectMenuInteraction) {
  const adminId = interaction.values[0]!;
  const guild = interaction.guild;
  if (!guild) return;

  let adminName = adminId;
  try {
    const member = guild.members.cache.get(adminId);
    adminName = member?.displayName ?? adminId;
  } catch {}

  const options = [1, 2, 3, 4, 5].map((n) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(STAR_LABELS[String(n)] ?? `${n} žvaigždutės`)
      .setValue(`${adminId}:${n}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("select_rating")
    .setPlaceholder("Pasirinkite įvertinimą")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.update({
    content: `**2/3:** Kaip įvertintumėte **${adminName}**?`,
    components: [row],
  });
}

// Step 3: After rating selected → show review text modal
// value format: "adminId:rating" (colon separated, safe since snowflake IDs are digits only)
async function handleSelectRating(interaction: import("discord.js").StringSelectMenuInteraction) {
  const value = interaction.values[0]!;
  const [adminId, rating] = value.split(":");
  const guild = interaction.guild;
  let adminName = adminId ?? "Administratorius";
  if (guild && adminId) {
    const member = guild.members.cache.get(adminId);
    adminName = member?.displayName ?? adminName;
  }

  const modal = new ModalBuilder()
    .setCustomId(`review_modal_${adminId}:${rating}`)
    .setTitle("Palikite Atsiliepimą");

  const textInput = new TextInputBuilder()
    .setCustomId("review_text")
    .setLabel("Jūsų atsiliepimas")
    .setPlaceholder(`Parašykite savo atsiliepimą apie ${adminName}...`)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

// Step 4: Review text submitted → send embed to channel
async function handleReviewModal(interaction: import("discord.js").ModalSubmitInteraction) {
  const withoutPrefix = interaction.customId.replace("review_modal_", "");
  const [adminId, ratingStr] = withoutPrefix.split(":");
  const rating = Number(ratingStr);

  const guild = interaction.guild;
  let adminName = adminId ?? "Administratorius";
  if (guild && adminId) {
    const member = guild.members.cache.get(adminId);
    adminName = member?.displayName ?? adminName;
  }

  const reviewText = interaction.fields.getTextInputValue("review_text");
  const reviewer = interaction.member as GuildMember | null;
  const reviewerName = reviewer?.displayName ?? interaction.user.username;

  const stars = "⭐".repeat(rating);

  const embed = new EmbedBuilder()
    .setTitle(`Atsiliepimas apie ${adminName}`)
    .setDescription(reviewText)
    .addFields(
      { name: "Įvertinimas", value: `${stars} (${rating}/5)`, inline: true },
      { name: "Administratorius", value: `<@${adminId}>`, inline: true },
      { name: "Atsiliepimą paliko", value: reviewerName, inline: true }
    )
    .setColor(rating >= 4 ? 0x57f287 : rating === 3 ? 0xfee75c : 0xed4245)
    .setTimestamp();

  if (!guild) return;

  const channel = await guild.channels.fetch(REVIEW_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    await interaction.reply({ content: "Klaida siunčiant atsiliepimą.", ephemeral: true });
    return;
  }

  await (channel as import("discord.js").TextChannel).send({ embeds: [embed] });

  await interaction.reply({
    content: `✅ Ačiū! Jūsų atsiliepimas apie **${adminName}** sėkmingai išsiųstas!`,
    ephemeral: true,
  });
}
