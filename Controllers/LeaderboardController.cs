using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MWI_Leaderboards.Data;
using MWI_Leaderboards.Models;

namespace MWI_Leaderboards.Controllers;

[ApiController]
[Route("api")]
public class LeaderboardController : ControllerBase
{
    private readonly LeaderboardContext _db;

    public LeaderboardController(LeaderboardContext db)
    {
        _db = db;
    }

    [HttpGet("types")]
    public async Task<IActionResult> GetTypes()
    {
        var types = await _db.LeaderboardEntries
            .Where(e => !e.IsPersonalRow)
            .Select(e => e.LeaderboardType)
            .Distinct()
            .OrderBy(t => t)
            .ToListAsync();
        return Ok(types);
    }

    [HttpGet("categories/{type}")]
    public async Task<IActionResult> GetCategories(string type)
    {
        var cats = await _db.LeaderboardEntries
            .Where(e => e.LeaderboardType == type && !e.IsPersonalRow)
            .Select(e => e.LeaderboardCategory)
            .Distinct()
            .OrderBy(c => c)
            .ToListAsync();
        return Ok(cats);
    }

    [HttpGet("xp/{type}/{category}")]
    public async Task<IActionResult> GetXp(string type, string category)
    {
        var firstSnapshots = await _db.LeaderboardEntries
            .Where(e => e.LeaderboardType == type && e.LeaderboardCategory == category && !e.IsPersonalRow)
            .GroupBy(e => e.Name)
            .Select(g => new { Name = g.Key, FirstFetchedAt = g.Min(e => e.FetchedAt) })
            .ToDictionaryAsync(x => x.Name, x => x.FirstFetchedAt);

        var rows = await _db.Database.SqlQueryRaw<XpDeltaRow>(@"
            SELECT Name, FetchedAt,
                Value2 - LAG(Value2) OVER (PARTITION BY Name ORDER BY FetchedAt) AS XpGained,
                DATEDIFF(MINUTE, LAG(FetchedAt) OVER (PARTITION BY Name ORDER BY FetchedAt), FetchedAt) AS MinutesSincePrevious
            FROM MWI.LeaderboardEntries
            WHERE LeaderboardType = {0} AND LeaderboardCategory = {1} AND IsPersonalRow = 0
            ORDER BY Name, FetchedAt ASC",
            type, category)
            .ToListAsync();

        var validTimestamps = rows
            .Where(r => r.XpGained.HasValue && r.XpGained.Value > 0)
            .Select(r => r.FetchedAt)
            .ToHashSet();

        var timestamps = rows
            .Select(r => r.FetchedAt)
            .Distinct()
            .Where(t => validTimestamps.Contains(t))
            .OrderBy(t => t)
            .ToList();

        var grouped = rows
            .Where(r => r.XpGained.HasValue
                     && r.XpGained.Value >= 0
                     && (!r.MinutesSincePrevious.HasValue || r.MinutesSincePrevious.Value <= 30)
                     && validTimestamps.Contains(r.FetchedAt)
                     && firstSnapshots.TryGetValue(r.Name, out var first)
                     && r.FetchedAt != first)
            .GroupBy(r => r.Name)
            .Where(g => g.Any())
            .Select(g => new {
                name = g.Key,
                data = g.Select(r => new {
                    x = r.FetchedAt.ToString("MM/dd HH:mm"),
                    y = r.XpGained!.Value
                })
            });

        return Ok(new
        {
            labels = timestamps.Select(t => t.ToString("MM/dd HH:mm")),
            players = grouped
        });
    }
}