namespace MWI_Leaderboards.Models;

public class LeaderboardEntry
{
    public int Id { get; set; }
    public required string LeaderboardType { get; set; }
    public required string LeaderboardCategory { get; set; }
    public DateTime FetchedAt { get; set; }
    public int Rank { get; set; }
    public required string Name { get; set; }
    public string? ChatIconHrid { get; set; }
    public string? NameColorHrid { get; set; }
    public string? SpecialChatIconHrid { get; set; }
    public long Value1 { get; set; }
    public long Value2 { get; set; }
    public bool IsPersonalRow { get; set; }
}