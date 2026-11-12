namespace MWI_Leaderboards;

public class Constants
{
    public string AccessToken { get; set; } = "";
    public string Hash { get; set; } = "";
    public string CharacterId { get; set; } = "";
    public string GameVersion { get; set; } = "";
    public string VersionTimestamp { get; set; } = "";

    // Leaderboard Types:
    // - standard          (Standard)
    // - ironcow           (Ironcow)
    // - legacy_ironcow    (Legacy Ironcow)
    // - steam_standard    (Standard (Steam))
    // - steam_ironcow     (Ironcow (Steam))
    // - guild             (Guild)
    public static readonly string[] LeaderboardTypes =
    {
        "standard", "ironcow"
    };

    // Leaderboard Categories:
    // - total_level       (Total Level)
    // - milking           (Milking)
    // - foraging          (Foraging)
    // - woodcutting       (Woodcutting)
    // - cheesesmithing    (Cheesesmithing)
    // - crafting          (Crafting)
    // - tailoring         (Tailoring)
    // - cooking           (Cooking)
    // - brewing           (Brewing)
    // - alchemy           (Alchemy)
    // - enhancing         (Enhancing)
    // - stamina           (Stamina)
    // - intelligence      (Intelligence)
    // - attack            (Attack)
    // - defense           (Defense)
    // - melee             (Melee)
    // - ranged            (Ranged)
    // - magic             (Magic)
    // - task_points       (Task Points)
    // - labyrinth_points  (Labyrinth Points)
    // - labyrinth_depth   (Labyrinth Depth)
    // - collection_points (Collection Points)
    // - bestiary_points   (Bestiary Points)
    // - fame_points       (Fame Points)
    // - guild             (Guild)
    public static readonly string[] LeaderboardCategories =
    {
        "total_level", "milking", "foraging", "woodcutting", "cheesesmithing", "crafting",
        "tailoring", "cooking", "brewing", "alchemy", "enhancing", "stamina", "intelligence",
        "attack", "defense", "melee", "ranged", "magic"
    };

    public static readonly string ProxyServer = "https://8.212.177.126:8080";
}