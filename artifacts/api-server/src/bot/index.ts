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
  WebhookClient,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { logger } from "../lib/logger";

const GUILD_ID = "1455214577334751428";

const ADMIN_ROLES = [
  "┋ Įkūrėjas",
  "┋Co.Savininkas",
  "┋Developeris",
  "┋Team Lead",
  "┋Vyr. Administratorius (-ė)",
  "┋Administratorius (-ė)",
  "┋Moderatorius (-ė)",
];

const STAR_LABELS: Record<string, string> = {
  "1": "⭐ 1 Žvaigždutė — Labai blogai",
  "2": "⭐⭐ 2 Žvaigždutės — Blogai",
  "3": "⭐⭐⭐ 3 Žvaigždutės — Vidutiniškai",
  "4": "⭐⭐⭐⭐ 4 Žvaigždutės — Gerai",
  "5": "⭐⭐⭐⭐⭐ 5 Žvaigždutės — Puikiai",
};

let webhookClient: WebhookClient | null = null;

function buildPanelEmbed() {
  return new EmbedBuilder()
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
}

function buildPanelRow() {
  const button = new ButtonBuilder()
    .setCustomId("start_review")
    .setLabel("Palikti admin atsiliepimą")
    .setStyle(ButtonStyle.Primary);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

export function startBot() {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    logger.error("DISCORD_BOT_TOKEN is not set");
    return;
  }

  const webhookUrl = process.env["DISCORD_WEBHOOK_URL"];
  if (webhookUrl) {
    webhookClient = new WebhookClient({ url: webhookUrl });
    logger.info("Webhook client initialized");
  } else {
    logger.warn("DISCORD_WEBHOOK_URL not set — reviews will fail");
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
    await registerCommands(token, readyClient.user.id);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // Slash command: /postpanel — posts the panel in current channel
      if (interaction.isChatInputCommand() && interaction.commandName === "postpanel") {
        await interaction.reply({
          embeds: [buildPanelEmbed()],
          components: [buildPanelRow()],
        });
        return;
      }

      // Step 1: Button → show admin dropdown
      if (interaction.isButton() && interaction.customId === "start_review") {
        await handleStartReview(interaction);
        return;
      }

      // Step 2: Admin selected → show rating dropdown
      if (interaction.isStringSelectMenu() && interaction.customId === "select_admin") {
        await handleSelectAdmin(interaction);
        return;
      }

      // Step 3: Rating selected → show review text modal
      if (interaction.isStringSelectMenu() && interaction.customId === "select_rating") {
        await handleSelectRating(interaction);
        return;
      }

      // Step 4: Review modal submitted → send embed via webhook
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

async function registerCommands(token: string, clientId: string) {
  const command = new SlashCommandBuilder()
    .setName("postpanel")
    .setDescription("Išsiųsti atsiliepimų skydelį šiame kanale");

  const rest = new REST().setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, GUILD_ID), {
      body: [command.toJSON()],
    });
    logger.info("Slash command /postpanel registered");
  } catch (err) {
    logger.error({ err }, "Failed to register slash commands");
  }
}

// Step 1: Fetch members with admin roles → show dropdown
async function handleStartReview(interaction: import("discord.js").ButtonInteraction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Klaida: serveris nerastas.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const allMembers = await guild.members.fetch();
  const seen = new Set<string>();
  const adminMembers: { id: string; name: string }[] = [];

  for (const [, member] of allMembers) {
    if (seen.has(member.id)) continue;
    const hasRole = member.roles.cache.some((r) =>
      ADMIN_ROLES.some((name) => r.name.trim() === name.trim())
    );
    if (hasRole) {
      seen.add(member.id);
      adminMembers.push({ id: member.id, name: member.displayName });
    }
  }

  logger.info({ adminCount: adminMembers.length }, "Admin members found");

  if (adminMembers.length === 0) {
    await interaction.editReply({ content: "Nerasta jokių administratorių." });
    return;
  }

  const options = adminMembers.slice(0, 25).map((m) =>
    new StringSelectMenuOptionBuilder().setLabel(m.name).setValue(m.id)
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

  let adminName = adminId;
  if (guild) {
    const member = guild.members.cache.get(adminId);
    adminName = member?.displayName ?? adminId;
  }

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

// Step 3: Rating selected → show review text modal
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

// Step 4: Review submitted → send via webhook
async function handleReviewModal(interaction: import("discord.js").ModalSubmitInteraction) {
  const withoutPrefix = interaction.customId.replace("review_modal_", "");
  const colonIdx = withoutPrefix.lastIndexOf(":");
  const adminId = withoutPrefix.substring(0, colonIdx);
  const rating = Number(withoutPrefix.substring(colonIdx + 1));

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
    .setTitle("📝 Administracijos Atsiliepimas")
    .addFields(
      { name: "Apžvelgtas Administratorius", value: `<@${adminId}>`, inline: false },
      { name: "Įvertinimas", value: stars, inline: false },
      { name: "Atsiliepimas", value: reviewText, inline: false },
      { name: "Pateikė", value: `<@${interaction.user.id}>`, inline: false }
    )
    .setColor(rating >= 4 ? 0x57f287 : rating === 3 ? 0xfee75c : 0xed4245)
    .setFooter({ text: "LUNARP.LT Admin Reviews" })
    .setTimestamp();

  if (!webhookClient) {
    await interaction.reply({ content: "Klaida: webhook nerastas.", ephemeral: true });
    return;
  }

  await webhookClient.send({ embeds: [embed] });

  await interaction.reply({
    content: `✅ Ačiū! Jūsų atsiliepimas apie **${adminName}** sėkmingai išsiųstas!`,
    ephemeral: true,
  });

  await interaction.followUp({
    embeds: [buildPanelEmbed()],
    components: [buildPanelRow()],
    ephemeral: false,
  });
}
