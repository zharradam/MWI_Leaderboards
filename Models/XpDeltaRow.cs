namespace MWI_Leaderboards.Models;

public class XpDeltaRow
{
    public required string Name { get; set; }
    public DateTime FetchedAt { get; set; }
    public long? XpGained { get; set; }
    public int? MinutesSincePrevious { get; set; }
}