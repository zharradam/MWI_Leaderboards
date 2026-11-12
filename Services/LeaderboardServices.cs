using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Microsoft.Playwright;
using MWI_Leaderboards.Data;
using MWI_Leaderboards.Models;
using System.Text.Json;

namespace MWI_Leaderboards.Services;

public class LeaderboardService
{
    private readonly string _wsUrl;
    private readonly Constants _constants;
    private readonly string _connectionString;
    private readonly ILogger<LeaderboardService> _logger;

    public LeaderboardService(Constants constants, string connectionString, ILogger<LeaderboardService> logger)
    {
        _constants = constants;
        _connectionString = connectionString;
        _logger = logger;
        _wsUrl = $"wss://api.milkywayidle.com/ws" +
                 $"?hash={_constants.Hash}" +
                 $"&characterId={_constants.CharacterId}" +
                 $"&gameVersion={_constants.GameVersion}" +
                 $"&versionTimestamp={_constants.VersionTimestamp}" +
                 $"&lang=en&isSteam=0";
    }

    public async Task FetchAllAsync()
    {
        using var playwright = await Playwright.CreateAsync();
        await using var browser = await playwright.Chromium.LaunchAsync(new()
        {
            Headless = true,
            Channel = "msedge",
       /*     Proxy = new Proxy
            {
                Server = Constants.ProxyServer
            }*/
        });

        var context = await browser.NewContextAsync();
        var page = await context.NewPageAsync();

        page.Console += (_, msg) =>
        {
            if (msg.Text.StartsWith("WS") || msg.Text.StartsWith("Error") || msg.Text.StartsWith("Leaderboard"))
                _logger.LogInformation($"[Browser]: {msg.Text}");
        };

        await SetupPageAsync(page);

        // Check Radiohead first before fetching everything
        var checkResult = await FetchLeaderboardAsync(page, "standard", "total_level");
        using var checkDoc = JsonDocument.Parse(checkResult);
        var checkRows = checkDoc.RootElement
            .GetProperty("leaderboard")
            .GetProperty("rows")
            .EnumerateArray();

        var radioheadElement = checkRows.FirstOrDefault(r =>
            r.TryGetProperty("name", out var n) && n.GetString() == "Radiohead");

        var newValue2 = radioheadElement.ValueKind != JsonValueKind.Undefined &&
            radioheadElement.TryGetProperty("value2", out var v2) ? v2.GetInt64() : 0;

        using var checkDb = new LeaderboardContext(_connectionString);
        var lastValue2 = await checkDb.LeaderboardEntries
            .Where(e => e.LeaderboardType == "standard" && e.LeaderboardCategory == "total_level" && e.Name == "Radiohead")
            .OrderByDescending(e => e.FetchedAt)
            .Select(e => e.Value2)
            .FirstOrDefaultAsync();

        if (lastValue2 != 0 && lastValue2 == newValue2)
        {
            _logger.LogInformation("Game data unchanged (Radiohead Value2 identical) — skipping run.");
            await browser.CloseAsync();
            return;
        }

        int total = Constants.LeaderboardTypes.Length * Constants.LeaderboardCategories.Length;
        int current = 0;
        int saved = 0;

        var fetchedAt = DateTime.UtcNow; // Single timestamp for the entire run

        foreach (var type in Constants.LeaderboardTypes)
        {
            foreach (var category in Constants.LeaderboardCategories)
            {
                current++;
                _logger.LogInformation($"[{current}/{total}] Fetching {type}/{category}...");

                try
                {
                    string result = await FetchLeaderboardAsync(page, type, category);
                    int count = await SaveLeaderboardAsync(result, type, category, fetchedAt);
                    saved += count;
                    _logger.LogInformation($"  Saved {count} entries.");
                    await Task.Delay(500);
                }
                catch (Exception ex)
                {
                    _logger.LogInformation($"  Failed: {ex.Message}");
                    if (ex.InnerException != null)
                        _logger.LogInformation($"  Inner: {ex.InnerException.Message}");
                    if (ex.InnerException?.InnerException != null)
                        _logger.LogInformation($"  Inner2: {ex.InnerException.InnerException.Message}");
                }
            }
        }

        _logger.LogInformation($"\nDone! Saved {saved} entries to database.");
        await browser.CloseAsync();
    }

    /**
    private async Task SetupPageAsync(IPage page)
    {
        _logger.LogInformation("Loading game page...");
        await page.GotoAsync("https://www.milkywayidle.com");
        await page.WaitForLoadStateAsync(LoadState.DOMContentLoaded);
        await page.EvaluateAsync($"document.cookie = 'accessToken={_constants.AccessToken}; path=/; domain=.milkywayidle.com; secure'");
        await page.EvaluateAsync($"localStorage.setItem('localHash', '{_constants.Hash}')");
        await page.GotoAsync($"https://www.milkywayidle.com/game?characterId={_constants.CharacterId}");
        await page.WaitForLoadStateAsync(LoadState.DOMContentLoaded);
    }*/

    private async Task SetupPageAsync(IPage page)
    {
        _logger.LogInformation("Loading game page...");

        var context = page.Context;

        // Set cookie before any navigation so it's present from the start
        await context.AddCookiesAsync(new[]
        {
        new Cookie
        {
            Name = "accessToken",
            Value = _constants.AccessToken,
            Domain = ".milkywayidle.com",
            Path = "/",
            Secure = true,
            HttpOnly = false
        }
    });

        // Set localStorage before the page loads via init script
        await context.AddInitScriptAsync($"localStorage.setItem('localHash', '{_constants.Hash}')");

        // Navigate directly to the game page — no need for the intermediate home page visit
        await page.GotoAsync($"https://www.milkywayidle.com/game?characterId={_constants.CharacterId}");

        // NetworkIdle is more appropriate for an SPA than DOMContentLoaded
        await page.WaitForLoadStateAsync(LoadState.NetworkIdle);

        _logger.LogInformation("Game page loaded.");
    }

    private async Task<string> FetchLeaderboardAsync(IPage page, string type, string category)
    {
        return await page.EvaluateAsync<string>($@"
        () => new Promise((resolve, reject) => {{
            const ws = new WebSocket('{_wsUrl}');
            let requested = false;

            ws.onmessage = (event) => {{
                const msg = JSON.parse(event.data);

                if (msg.type === 'init_character_data' && !requested) {{
                    requested = true;
                    ws.send(JSON.stringify({{
                        type: 'get_leaderboard',
                        getLeaderboardData: {{
                            leaderboardType: '{type}',
                            leaderboardCategory: '{category}'
                        }},
                        ts: Date.now()
                    }}));
                }}

                if (msg.type === 'ping') {{
                    ws.send(JSON.stringify({{
                        type: 'pong',
                        pongData: {{ hash: msg.pingData.hash }},
                        ts: Date.now()
                    }}));
                }}

                if (msg.type === 'get_leaderboard' || msg.type === 'leaderboard_updated') {{
                    console.log('Leaderboard message: ' + JSON.stringify(msg).substring(0, 300));
                    ws.close();
                    resolve(JSON.stringify(msg));
                }}
            }};

            ws.onerror = () => reject('WebSocket error');
            ws.onclose = (e) => {{
                if (!requested) reject('Closed before init: ' + e.code);
            }};

            setTimeout(() => reject('Timeout'), 30000);
        }})
    ");
    }

    private async Task<int> SaveLeaderboardAsync(string json, string type, string category, DateTime fetchedAt)
    {
        using var doc = JsonDocument.Parse(json);
        var entries = new List<LeaderboardEntry>();

        var root = doc.RootElement;
        JsonElement rowsElement;

        if (root.TryGetProperty("leaderboard", out var leaderboard) &&
            leaderboard.TryGetProperty("rows", out rowsElement))
        {
            foreach (var row in rowsElement.EnumerateArray())
                entries.Add(ParseEntry(row, type, category, fetchedAt, false));
        }

        if (root.TryGetProperty("personalRow", out var personalRow) &&
            personalRow.ValueKind == JsonValueKind.Object)
        {
            entries.Add(ParseEntry(personalRow, type, category, fetchedAt, true));
        }

        using var db = new LeaderboardContext(_connectionString);
        await db.LeaderboardEntries.AddRangeAsync(entries);
        await db.SaveChangesAsync();

        return entries.Count;
    }

    private LeaderboardEntry ParseEntry(JsonElement element, string type, string category, DateTime fetchedAt, bool isPersonalRow)
    {
        return new LeaderboardEntry
        {
            LeaderboardType = type,
            LeaderboardCategory = category,
            FetchedAt = fetchedAt,
            Rank = element.TryGetProperty("rank", out var rank) && rank.ValueKind == JsonValueKind.Number ? rank.GetInt32() : 0,
            Name = element.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String ? name.GetString() ?? "" : "",
            ChatIconHrid = element.TryGetProperty("chatIconHrid", out var chatIcon) && chatIcon.ValueKind == JsonValueKind.String ? chatIcon.GetString() : null,
            NameColorHrid = element.TryGetProperty("nameColorHrid", out var nameColor) && nameColor.ValueKind == JsonValueKind.String ? nameColor.GetString() : null,
            SpecialChatIconHrid = element.TryGetProperty("specialChatIconHrid", out var specialIcon) && specialIcon.ValueKind == JsonValueKind.String ? specialIcon.GetString() : null,
            Value1 = element.TryGetProperty("value1", out var v1) && v1.ValueKind == JsonValueKind.Number ? v1.GetInt64() : 0,
            Value2 = element.TryGetProperty("value2", out var v2) && v2.ValueKind == JsonValueKind.Number ? v2.GetInt64() : 0,
            IsPersonalRow = isPersonalRow
        };
    }
}