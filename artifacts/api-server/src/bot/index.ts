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
const CATEGORY_ID = "1490789771478564924";
const REVIEW_CHANNEL_ID = "1490789916995621050";

const ADMIN_ROLES = [
  "Įkūrėjas",
  "Co.Savininkas",
  "Developeris",
  "Team Lead",
  "Vyr. Administratorius (-ė)",
  "Administratorius (-ė)",
  "Moderatorius (-ė)",
];

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
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ tag: readyClient.user.tag }, "Discord bot is ready");
    await postReviewPanel(readyClient);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === "start_review") {
        await handleStartReview(interaction);
        return;
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "select_admin"
      ) {
        await handleSelectAdmin(interaction);
        return;
      }

      if (
        interaction.isStringSelectMenu() &&
        interaction.customId === "select_rating"
      ) {
        await handleSelectRating(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith("review_modal_")) {
        await handleModalSubmit(interaction);
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

async function handleStartReview(interaction: import("discord.js").ButtonInteraction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: "Klaida: serveris nerastas.", ephemeral: true });
    return;
  }

  await guild.members.fetch();
  const adminMembers: { id: string; name: string }[] = [];

  for (const roleName of ADMIN_ROLES) {
    const role = guild.roles.cache.find((r) => r.name === roleName);
    if (!role) continue;
    for (const [, member] of role.members) {
      if (!adminMembers.find((m) => m.id === member.id)) {
        adminMembers.push({
          id: member.id,
          name: member.displayName,
        });
      }
    }
  }

  if (adminMembers.length === 0) {
    await interaction.reply({
      content: "Nerasta jokių administratorių su nurodytomis rolėmis.",
      ephemeral: true,
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

  await interaction.reply({
    content: "**1/3:** Pasirinkite administratorių, kurį norite įvertinti:",
    components: [row],
    ephemeral: true,
  });
}

async function handleSelectAdmin(interaction: import("discord.js").StringSelectMenuInteraction) {
  const adminId = interaction.values[0];
  const guild = interaction.guild;
  if (!guild) return;

  let adminName = adminId;
  try {
    const member = await guild.members.fetch(adminId);
    adminName = member.displayName;
  } catch {}

  const options = [1, 2, 3, 4, 5].map((n) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(STAR_LABELS[String(n)] ?? `${n} žvaigždutės`)
      .setValue(`${adminId}__${adminName}__${n}`)
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

async function handleSelectRating(interaction: import("discord.js").StringSelectMenuInteraction) {
  const value = interaction.values[0];
  const parts = value.split("__");
  const adminId = parts[0];
  const adminName = parts[1];
  const rating = parts[2];

  const modal = new ModalBuilder()
    .setCustomId(`review_modal_${adminId}__${adminName}__${rating}`)
    .setTitle("Palikite Atsiliepimą");

  const textInput = new TextInputBuilder()
    .setCustomId("review_text")
    .setLabel("Jūsų atsiliepimas")
    .setPlaceholder(`Parašykite savo atsiliepimą apie šį administratorių...`)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(1000);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(textInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction: import("discord.js").ModalSubmitInteraction) {
  const parts = interaction.customId.replace("review_modal_", "").split("__");
  const adminId = parts[0];
  const adminName = parts[1];
  const rating = Number(parts[2]);

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
