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

      // Step 2: Admin name modal submit → show rating dropdown
      if (interaction.isModalSubmit() && interaction.customId === "admin_name_modal") {
        await handleAdminNameModal(interaction);
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

// Step 1: Show modal where user types the admin's nick
async function handleStartReview(interaction: import("discord.js").ButtonInteraction) {
  const modal = new ModalBuilder()
    .setCustomId("admin_name_modal")
    .setTitle("1/3: Pasirinkite administratorių");

  const adminInput = new TextInputBuilder()
    .setCustomId("admin_name")
    .setLabel("Administratoriaus nickname")
    .setPlaceholder("Įrašykite administratoriaus Discord vardą...")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(64);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(adminInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

// Step 2: After admin name entered → show rating dropdown
async function handleAdminNameModal(interaction: import("discord.js").ModalSubmitInteraction) {
  const adminName = interaction.fields.getTextInputValue("admin_name").trim();

  const options = [1, 2, 3, 4, 5].map((n) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(STAR_LABELS[String(n)] ?? `${n} žvaigždutės`)
      .setValue(`${encodeURIComponent(adminName)}__${n}`)
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId("select_rating")
    .setPlaceholder("Pasirinkite įvertinimą")
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  await interaction.reply({
    content: `**2/3:** Kaip įvertintumėte **${adminName}**?`,
    components: [row],
    ephemeral: true,
  });
}

// Step 3: After rating selected → show review text modal
async function handleSelectRating(interaction: import("discord.js").StringSelectMenuInteraction) {
  const value = interaction.values[0]!;
  const separatorIdx = value.lastIndexOf("__");
  const adminNameEncoded = value.substring(0, separatorIdx);
  const rating = value.substring(separatorIdx + 2);
  const adminName = decodeURIComponent(adminNameEncoded);

  const modal = new ModalBuilder()
    .setCustomId(`review_modal_${adminNameEncoded}__${rating}`)
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
  const separatorIdx = withoutPrefix.lastIndexOf("__");
  const adminNameEncoded = withoutPrefix.substring(0, separatorIdx);
  const adminName = decodeURIComponent(adminNameEncoded);
  const rating = Number(withoutPrefix.substring(separatorIdx + 2));

  const reviewText = interaction.fields.getTextInputValue("review_text");
  const reviewer = interaction.member as GuildMember | null;
  const reviewerName = reviewer?.displayName ?? interaction.user.username;

  const stars = "⭐".repeat(rating);

  const embed = new EmbedBuilder()
    .setTitle(`Atsiliepimas apie ${adminName}`)
    .setDescription(reviewText)
    .addFields(
      { name: "Įvertinimas", value: `${stars} (${rating}/5)`, inline: true },
      { name: "Administratorius", value: adminName, inline: true },
      { name: "Atsiliepimą paliko", value: reviewerName, inline: true }
    )
    .setColor(rating >= 4 ? 0x57f287 : rating === 3 ? 0xfee75c : 0xed4245)
    .setTimestamp();

  const guild = interaction.guild;
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
