using Microsoft.EntityFrameworkCore;
using MWI_Leaderboards.Models;

namespace MWI_Leaderboards.Data;

public class LeaderboardContext : DbContext
{
    public DbSet<LeaderboardEntry> LeaderboardEntries { get; set; }
    public DbSet<XpDeltaRow> XpDeltaRows { get; set; }

    private readonly string? _connectionString;

    public LeaderboardContext(string connectionString)
    {
        _connectionString = connectionString;
    }

    public LeaderboardContext(DbContextOptions<LeaderboardContext> options)
        : base(options) { }

    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        if (!optionsBuilder.IsConfigured)
            optionsBuilder.UseSqlServer(_connectionString);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasDefaultSchema("MWI");

        modelBuilder.Entity<LeaderboardEntry>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.LeaderboardType).IsRequired().HasMaxLength(50);
            entity.Property(e => e.LeaderboardCategory).IsRequired().HasMaxLength(50);
            entity.Property(e => e.Name).IsRequired().HasMaxLength(100);
            entity.Property(e => e.ChatIconHrid).HasMaxLength(200);
            entity.Property(e => e.NameColorHrid).HasMaxLength(200);
            entity.Property(e => e.SpecialChatIconHrid).HasMaxLength(200);
        });

        modelBuilder.Entity<XpDeltaRow>().HasNoKey();
    }
}